-- Atualizar Configurações para usar as APIs oficiais (Nominatim e OSRM)
-- Execute se a tabela CONFIGURACAO já existir com valores antigos (ex.: integrabrasil).

UPDATE "CONFIGURACAO" SET "VALOR" = 'https://nominatim.openstreetmap.org', "DHMAINTENANCE" = CURRENT_TIMESTAMP WHERE "CHAVE" = 'nominatim_server';
UPDATE "CONFIGURACAO" SET "VALOR" = 'https://router.project-osrm.org/route/v1/driving-hgv', "DHMAINTENANCE" = CURRENT_TIMESTAMP WHERE "CHAVE" = 'router_server';
