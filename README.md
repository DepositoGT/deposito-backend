# Deposito Backend

Stack:
- Node.js + Express
- Prisma ORM
- Supabase Postgres

## Configuración
1. Configura `.env` con tus conexiones de Supabase (pooler y directa para migraciones):

```
# Connect to Supabase via connection pooling
DATABASE_URL="postgresql://postgres.oxsmvtnvnspguafrmdpy:[YOUR-PASSWORD]@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Direct connection to the database. Used for migrations
DIRECT_URL="postgresql://postgres.oxsmvtnvnspguafrmdpy:[YOUR-PASSWORD]@aws-1-us-east-2.pooler.supabase.com:5432/postgres"

PORT=3000
```

2. Genera el cliente y crea el esquema en tu DB:
   - `npm run prisma:generate`
   - `npm run migrate`

3. Ejecuta el seed de catálogos:
   - `npm run seed`

4. Levanta el servidor:
   - `npm run dev`

## Scripts
- dev: nodemon src/index.js
- start: node src/index.js
- seed: node prisma/seed.js
- migrate: prisma migrate dev
- prisma:generate: prisma generate

## Endpoints
- GET /health: verifica conexión a la base de datos
- GET /api: ping básico

### Ventas
- GET /api/sales?period=month&status=Pendiente&page=1&pageSize=50
   Lista ventas con filtros de periodo y estado.
- POST /api/sales
   Crea una venta (el backend asigna estado inicial 'Pendiente').
- PATCH /api/sales/:id/status
   Actualiza sólo el estado de una venta.
   Body (uno de los dos campos):
   {
      "status_id": 2
   }
   o
   {
      "status_name": "Pagado"
   }
   Respuesta: objeto venta actualizado.

