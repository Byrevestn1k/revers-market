import { HttpError, type AuthProvider, type DataProvider } from 'react-admin';
const API = import.meta.env.VITE_API_URL ?? '';
export type AdminSession = { user: { id: string; username: string }; permissions: string[]; roles: string[] };
export async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Admin-Action': '1', ...init?.headers } });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new HttpError(body?.message ?? 'Не вдалося виконати запит', response.status, body);
  return body as T;
}
let sessionRequest: Promise<AdminSession> | undefined;
// Coalesce simultaneous React-admin auth/identity/permission checks, never cache a resolved session.
export const getAdminSession = () => {
  sessionRequest ??= adminRequest<AdminSession>('/api/admin/session').finally(() => { sessionRequest = undefined; });
  return sessionRequest;
};
export const authProvider: AuthProvider = {
  login: async ({ username, password }) => {
    await adminRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    await getAdminSession();
  },
  logout: async () => { await adminRequest('/api/auth/logout', { method: 'POST' }); },
  checkAuth: async () => { await getAdminSession(); },
  checkError: async (error) => { if (error.status === 401) throw error; },
  getPermissions: async () => {
    try { return (await getAdminSession()).permissions; }
    catch (error) { if (error instanceof HttpError && [401, 403].includes(error.status)) return []; throw error; }
  },
  getIdentity: async () => { const session = await getAdminSession(); return { id: session.user.id, fullName: session.user.username }; },
};
const unsupported = async (): Promise<never> => { throw new Error('Ця операція ще не доступна'); };
export const dataProvider: DataProvider = {
  getList: async (resource, params) => {
    const query = new URLSearchParams({ page: String(params.pagination?.page ?? 1), perPage: String(params.pagination?.perPage ?? 25), q: String(params.filter?.q ?? '') });
    for (const [key,value] of Object.entries(params.filter ?? {})) if (value != null && value !== '') query.set(key,String(value));
    query.set('sort', params.sort?.field ?? 'createdAt'); query.set('order', params.sort?.order ?? 'DESC');
    return adminRequest(`/api/admin/${resource}?${query}`);
  },
  getOne: (resource, params) => adminRequest(`/api/admin/${resource}/${params.id}`), getMany: unsupported, getManyReference: unsupported,
  create: unsupported, update: unsupported, updateMany: unsupported, delete: unsupported, deleteMany: unsupported,
};
