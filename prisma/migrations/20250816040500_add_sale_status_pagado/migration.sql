-- Add missing sale status 'Pagado'
INSERT INTO sale_statuses (name) VALUES ('Pagado') ON CONFLICT (name) DO NOTHING;
