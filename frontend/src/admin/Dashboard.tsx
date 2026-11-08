import { useEffect, useRef, useState } from 'react';
import { usePermissions, Title } from 'react-admin';
import { Alert, Box, Button, Card, CardContent, TextField, Typography, MenuItem } from '@mui/material';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { adminRequest } from './api';
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
type Report = { period: { from: string; to: string }; metrics: { id: string; label: string; value: number | null; unit?: string; description: string }[]; series: { date: string; users: number; products: number; requests: number; offers: number; deals: number }[]; generatedAt: string };
const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
function Chart({ report, type }: { report: Report; type: 'line' | 'bar' }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current) return;
    const chart = echarts.init(element.current);
    const series = [{ key: 'users', label: 'Реєстрації' }, { key: 'products', label: 'Товари' }, { key: 'requests', label: 'Запити' }, { key: 'offers', label: 'Пропозиції' }, { key: 'deals', label: 'Угоди' }] as const;
    chart.setOption({ animation: false, tooltip: { trigger: 'axis', renderMode: 'richText' }, legend: { bottom: 0, type: 'scroll' }, grid: { left: 42, right: 12, top: 20, bottom: 80 }, xAxis: { type: 'category', data: report.series.map(row => row.date.slice(0, 10)) }, yAxis: { type: 'value', minInterval: 1 }, series: series.map(s => ({ name: s.label, type, data: report.series.map(row => row[s.key]), smooth: false })) });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [report, type]);
  return <div ref={element} role="img" aria-label="Щоденна кількість створених записів" style={{ height: 340, width: '100%' }} />;
}
export function Dashboard() {
  const { permissions } = usePermissions<string[]>();
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [chartType, setChartType] = useState<'line' | 'bar'>('line');
  const canRead = permissions?.includes('analytics.read');
  async function load() {
    setError(''); setLoading(true); setReport(null);
    try { setReport(await adminRequest<Report>(`/api/admin/dashboard?${new URLSearchParams({ from: `${from}T00:00:00Z`, to: `${to}T00:00:00Z` })}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Помилка звіту'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (canRead) void load(); }, [canRead]);
  return <Box sx={{ py: 2, minWidth: 0 }}><Title title="Головна панель" />
    <Typography variant="h4" gutterBottom>ДещоТреба · Адміністрування</Typography>
    {!canRead ? <Alert severity="info">Виберіть доступний розділ у меню. Перегляд статистики потребує окремого дозволу.</Alert> : <>
      <Box component="form" onSubmit={e => { e.preventDefault(); void load(); }} sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, my: 2 }}>
        <TextField label="Від (UTC, включно)" type="date" value={from} onChange={e => setFrom(e.target.value)} required slotProps={{ inputLabel: { shrink: true } }} />
        <TextField label="До (UTC, не включно)" type="date" value={to} onChange={e => setTo(e.target.value)} required slotProps={{ inputLabel: { shrink: true } }} />
        <Button type="submit" variant="contained" disabled={loading}>Показати</Button>
        <TextField label="Графік" select value={chartType} onChange={e => setChartType(e.target.value as 'line' | 'bar')}><MenuItem value="line">Лінії</MenuItem><MenuItem value="bar">Стовпчики</MenuItem></TextField>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {loading && <Typography role="status">Завантаження…</Typography>}
      {report && <><Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 2 }}>
        {report.metrics.map(metric => <Card key={metric.id}><CardContent><Typography color="text.secondary">{metric.label}</Typography><Typography variant="h4">{metric.value === null ? 'Даних поки немає' : `${metric.value.toLocaleString('uk-UA')}${metric.unit ? ` ${metric.unit}` : ''}`}</Typography><Typography variant="body2" sx={{ mt: 1 }}>{metric.description.replace('accepted_quantity > 0', 'прийнятою кількістю понад 0').replace('last_seen_at не є історією активності', 'час останнього відвідування не є історією активності')}</Typography></CardContent></Card>)}
      </Box><Card sx={{ mt: 2 }}><CardContent><Typography variant="h6">Створені записи за днями (UTC)</Typography>{report.series.length ? <Chart report={report} type={chartType} /> : <Typography>Даних поки немає</Typography>}</CardContent></Card>
      <Typography variant="body2" sx={{ my: 2 }}>Оновлено: {new Date(report.generatedAt).toLocaleString('uk-UA')}. Дані відображають наявні записи; історія видалених записів не відновлюється.</Typography></>}
      <Alert severity="info">DAU, WAU, MAU, утримання та події пошуку потребують окремого збору даних. Ці звіти ще не реалізовані.</Alert>
    </>}
  </Box>;
}
