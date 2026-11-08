import { resources } from './resources';
import { Layout, Menu, usePermissions, type LayoutProps } from 'react-admin';
function AdminMenu() {
  const { permissions } = usePermissions<string[]>();
  return <Menu><Menu.DashboardItem />{resources.filter(r => permissions?.includes(r.permission)).map(r => <Menu.ResourceItem key={r.name} name={r.name} />)}{permissions?.includes('roles.read') && <Menu.Item to="/roles" primaryText="Ролі й дозволи" />}<Menu.Item to="/" primaryText="Повернутися до сайту" onClick={(e: React.MouseEvent) => { e.preventDefault(); window.location.assign('/'); }} /></Menu>;
}
export function AdminLayout(props: LayoutProps) {
  return <Layout {...props} menu={AdminMenu} sx={{ minWidth: 0, maxWidth: '100vw', '& .RaLayout-contentWithSidebar': { minWidth: 0 }, '& .list-page, & .RaList-main': { minWidth: 0, width: '100%', maxWidth: '100%' }, '& .RaLayout-content': { minWidth: 0, px: { xs: 1, sm: 3 } }, '& .RaList-content': { minWidth: 0, maxWidth: '100%', overflowX: 'auto' }, '& .RaDatagrid-tableWrapper': { maxWidth: '100%', overflowX: 'auto' }, '& .RaLayout-appFrame': { minWidth: 0 }, '& .MuiTypography-h4': { fontSize: { xs: '1.5rem', md: '2rem' } } }} />;
}
