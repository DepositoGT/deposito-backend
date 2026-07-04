# Auth: cookies httpOnly + hardening

Fecha: 2026-07-04

## Problema

El JWT se guarda en `localStorage` (robable por XSS) y viaja como `Authorization: Bearer`.
El secreto JWT tiene fallback débil `'clave_secreta'`. No hay helmet ni rate limiting.
Front y back están en subdominios `*.vercel.app` = cross-site (public suffix), así que
una cookie `SameSite=Lax` normal no viajaría entre ellos.

## Solución

### Proxy same-origin

El frontend llama a `/api/*` (relativo). Vite `server.proxy` (dev) y `vercel.json`
rewrites (prod, `/api/:path* -> https://deposito-backend-hsfi.vercel.app/api/:path*`)
reenvían al backend. Para el navegador todo es un origen → cookie `SameSite=Lax`
first-party, sin CORS, sin cookies de terceros. `VITE_API_URL = /api`.

### Dos tokens (cookies httpOnly)

- `access_token`: JWT, 20 min, `HttpOnly; Secure; SameSite=Lax; Path=/`. Lleva permisos.
- `refresh_token`: opaco (`crypto.randomBytes(32)`), 7 días, `Path=/api/auth`. Guardado
  hasheado (SHA-256) en DB (`RefreshToken`). Rotación en cada refresh; reuso de token
  revocado = robo → revoca todas las sesiones del usuario.

`Secure` sólo en producción (en dev localhost es http).

### Backend

- Modelo Prisma `RefreshToken { id, user_id, token_hash, expires_at, revoked_at, replaced_by, created_at }` → `prisma db push` (aditivo).
- Endpoints `/api/auth`: `login` (setea cookies, no devuelve token en body), `POST /refresh`,
  `GET /me` (user fresco desde DB), `POST /logout`.
- `Auth` middleware: lee `req.cookies.access_token`, fallback header `Bearer`.
- `JWT_SECRET` obligatorio y fuerte (≥32 chars, ≠ `clave_secreta`) o el server no arranca
  (`src/config/security.js`).
- `helmet` global + `express-rate-limit` (10/15min) en `/auth/login` y `/auth/validate-admin`.
  `app.set('trust proxy', 1)` para IP real detrás de Vercel.

### Frontend

- `apiFetch`: `credentials: 'include'`; en 401 intenta `/auth/refresh` una vez (deduplicado)
  y reintenta la request original.
- Deja de persistir token en `localStorage`. `AuthProvider` restaura sesión con `/auth/me`.
- `logout` llama `POST /auth/logout`.

### CSRF

`SameSite=Lax` + same-origin cubre CSRF (bloquea POST/PUT/DELETE cross-site). Sin token extra.

### Testing

- Backend: self-check runnable login→me→refresh(rota)→reuso(revoca)→logout (pasó).
- Frontend: `tsc --noEmit` (0 errores).

### Migración operativa (Vercel)

- Frontend: setear env `VITE_API_URL=/api`.
- Backend: setear `JWT_SECRET` fuerte (≥32 chars) o el server no bootea.
- Sesiones viejas (token en localStorage) se cortan → re-login una vez.
