"""Import the official KATOTTG XLSX using only Python's standard library.

Usage: python backend/scripts/import-settlements.py backend/data/katottg-source.xlsx
"""
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile

source = Path(sys.argv[1])
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(source) as archive:
    strings = [''.join(node.itertext()) for node in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', ns)]
    sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
rows = []
for row in sheet.findall('.//s:row', ns):
    values = {}
    for cell in row:
        value = cell.find('s:v', ns)
        if value is not None:
            values[''.join(c for c in cell.attrib['r'] if c.isalpha())] = (strings[int(value.text)] if cell.attrib.get('t') == 's' else value.text).strip()
    if values.get('F') in ('O', 'P', 'H', 'M', 'T', 'C', 'X', 'K'):
        rows.append(values)
names = {next(row[column] for column in ('E', 'D', 'C', 'B', 'A') if row.get(column)): row['G'] for row in rows}
types = {'M': 'city', 'K': 'city', 'T': 'town', 'X': 'town', 'C': 'village'}
settlements = []
for row in rows:
    if row['F'] not in types:
        continue
    code = row.get('D') or row['A']
    region = names[row['A']]
    settlements.append(dict(code=code, name=row['G'], type=types[row['F']],
                            district=(names[row['B']] + ' район') if row.get('B') else '',
                            region=region if row['F'] == 'K' or region.startswith('Автономна') else region + ' область',
                            community=names.get(row.get('C'), '')))
assert len(settlements) > 27000
assert len({item['code'] for item in settlements}) == len(settlements)
target = source.parent / 'settlements.json'
target.write_text(json.dumps({'version': '2026-07-07', 'source': 'https://mininfra.gov.ua/storage/app/sites/1/uploaded-files/kodifikator-07-07.xlsx',
                             'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'settlements': settlements}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'Imported {len(settlements)} settlements to {target}')
