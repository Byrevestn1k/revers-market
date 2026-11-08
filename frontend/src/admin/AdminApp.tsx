import { Admin, CustomRoutes, Resource, defaultTheme } from 'react-admin';
import { BrowserRouter, Route } from 'react-router-dom';
import { authProvider, dataProvider } from './api';
import { i18nProvider } from './i18n';
import { lazy, Suspense } from 'react';
const LazyDashboard = lazy(() => import('./Dashboard').then(module => ({ default: module.Dashboard })));
function Dashboard() { return <Suspense fallback={<p>Завантаження статистики…</p>}><LazyDashboard /></Suspense>; }
import { ResourceList, resources } from './resources';
import { ResourceShow } from './ResourceShow';
import { Roles } from './Roles';
import { AdminLayout } from './Layout';
export default function AdminApp() {
  return <BrowserRouter basename="/admin"><Admin disableTelemetry title="ДещоТреба · Адміністрування" authProvider={authProvider} dataProvider={dataProvider} i18nProvider={i18nProvider} dashboard={Dashboard} layout={AdminLayout} requireAuth theme={{ ...defaultTheme, palette: { ...defaultTheme.palette, primary: { main: '#236b53' }, secondary: { main: '#b56a20' } }, typography: { fontFamily: 'system-ui, sans-serif' } }}>
    {resources.map(r => <Resource key={r.name} name={r.name} options={{ label: r.label }} show={ResourceShow} list={() => <ResourceList fields={r.fields} dates={r.dates} permission={r.permission} />} />)}
    <CustomRoutes><Route path="roles" element={<Roles />} /></CustomRoutes>
  </Admin></BrowserRouter>;
}
