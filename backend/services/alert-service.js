// backend/services/alert-service.js
// Service para detectar e gerar alertas automáticos em viagens
// Versão: 2.0 - Com ETA dinâmico e detecção de desvios
// Data: 2025-01-16

const sql = require('mssql');
const axios = require('axios');
const { poolPromise } = require('../config/db');

const alertService = {
  /**
   * Verificar alertas para uma viagem específica
   * @param {number} idViagem - ID da viagem
   * @returns {Promise<Array>} Lista de alertas encontrados
   */
  verificarAlertas: async (idViagem) => {
    const pool = await poolPromise;
    const alertas = [];

    try {
      console.log(`🔍 [Alertas] Verificando viagem ${idViagem}...`);
      // Buscar motorista da viagem (para incluir nos alertas)
      let cdmotorista = null;
      try {
        // Buscar de CONVOCACAO (mais confiável, já que é a relação atual)
        const motoristaResult = await pool.request()
          .input('idviagem', sql.Decimal(15, 0), idViagem)
          .query(`
            SELECT TOP 1 CDCADASTRO_MOTORISTA 
            FROM [dbo].[CONVOCACAO]
            WHERE IDVIAGEM = @idviagem
              AND STATUS IN ('ACEITA', 'CONFIRMADA')
            ORDER BY DHRESPOSTA DESC
          `);
        if (motoristaResult.recordset.length > 0) {
          cdmotorista = motoristaResult.recordset[0].CDCADASTRO_MOTORISTA;
        }
      } catch (err) {
        console.warn('Erro ao buscar motorista da viagem:', err.message);
      }

      // 1. Verificar paradas não planejadas (> 30 min)
      const paradaAlerta = await alertService.verificarParadaProlongada(idViagem, pool);
      if (paradaAlerta) {
        paradaAlerta.cdmotorista = cdmotorista;
        alertas.push(paradaAlerta);
        console.log(`   ✅ Parada prolongada detectada`);
      }

      // 2. Verificar atraso no ETA (com cálculo dinâmico)
      const atrasoAlerta = await alertService.verificarAtraso(idViagem, pool);
      if (atrasoAlerta) {
        atrasoAlerta.cdmotorista = cdmotorista;
        alertas.push(atrasoAlerta);
        console.log(`   ✅ Atraso detectado`);
      }

      // 2.1 Verificar ETA > prazo de entrega (alerta preventivo)
      const etaAlerta = await alertService.verificarETAPrazo(idViagem, pool);
      if (etaAlerta) {
        etaAlerta.cdmotorista = cdmotorista;
        alertas.push(etaAlerta);
        console.log(`   ✅ ETA preventivo detectado`);
      }

      // 3. Verificar motorista offline (> 90 min)
      const offlineAlerta = await alertService.verificarOffline(idViagem, pool);
      if (offlineAlerta) {
        offlineAlerta.cdmotorista = cdmotorista;
        alertas.push(offlineAlerta);
        console.log(`   ✅ Motorista offline detectado`);
      }

      // 4. Verificar desvio de rota (implementado com buffer de 500m)
      const desvioAlerta = await alertService.verificarDesvioRota(idViagem, pool);
      if (desvioAlerta) {
        desvioAlerta.cdmotorista = cdmotorista;
        alertas.push(desvioAlerta);
        console.log(`   ✅ Desvio de rota detectado`);
      }

      // Salvar alertas novos no banco
      let alertasSalvos = 0;
      for (const alerta of alertas) {
        const salvo = await alertService.salvarAlerta(alerta, pool);
        if (salvo) {
          alertasSalvos++;
          console.log(`   ✅ Alerta ${alerta.type.toUpperCase()} salvo com sucesso`);
        } else {
          console.log(`   ℹ️  Alerta ${alerta.type.toUpperCase()} não salvo (já existe ou erro)`);
        }
      }

      if (alertas.length > 0) {
        console.log(`📋 [Viagem ${idViagem}] ${alertasSalvos} de ${alertas.length} alerta(s) salvo(s) no banco`);
      } else {
        console.log(`   ℹ️  Nenhum alerta detectado para viagem ${idViagem}`);
      }

      return alertas;
    } catch (err) {
      console.error('Erro ao verificar alertas:', err);
      return [];
    }
  },

  /**
   * Verificar se motorista está parado há muito tempo
   */
  verificarParadaProlongada: async (idViagem, pool) => {
    try {
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .query(`
          DECLARE @paradaMinutos INT = 30; -- Configurável via ALERT_CONFIG
          
          -- Buscar últimas posições (últimas 3)
          WITH UltimasPosicoes AS (
            SELECT TOP 3
              LATITUDE, LONGITUDE, VELOCIDADE, DHREGISTRO
            FROM [dbo].[VIAGEMRASTREAMENTO]
            WHERE IDVIAGEM = @idviagem
              AND DHREGISTRO >= DATEADD(MINUTE, -60, GETDATE())
            ORDER BY DHREGISTRO DESC
          )
          SELECT 
            COUNT(*) as total,
            AVG(VELOCIDADE) as velocidadeMedia,
            MIN(DHREGISTRO) as primeiraParada,
            MAX(DHREGISTRO) as ultimaParada,
            DATEDIFF(MINUTE, MIN(DHREGISTRO), MAX(DHREGISTRO)) as minutosParado
          FROM UltimasPosicoes
          WHERE VELOCIDADE < 5 -- Considera parado se velocidade < 5 km/h
        `);

      if (result.recordset.length > 0) {
        const data = result.recordset[0];
        
        // Se parado há mais de 30 minutos
        if (data.minutosParado >= 30 && data.total >= 2) {
          // Verificar se já existe alerta ativo deste tipo
          const existeAlerta = await pool.request()
            .input('idviagem', sql.Decimal(15, 0), idViagem)
            .input('type', sql.NVarChar(20), 'parada')
            .query(`
              SELECT TOP 1 ID FROM [dbo].[ALERTS]
              WHERE IDVIAGEM = @idviagem
                AND TYPE = @type
                AND RESOLVED = 0
            `);

          if (existeAlerta.recordset.length === 0) {
            return {
              idviagem: idViagem,
              type: 'parada',
              message: `Motorista parado há ${data.minutosParado} minutos`,
              severity: data.minutosParado > 60 ? 'high' : 'medium',
              details: JSON.stringify({
                minutosParado: data.minutosParado,
                velocidadeMedia: data.velocidadeMedia
              })
            };
          }
        }
      }

      return null;
    } catch (err) {
      console.error('Erro ao verificar parada prolongada:', err);
      return null;
    }
  },

  /**
   * Calcular ETA dinâmico usando OSRM
   * @param {number} lat1 - Latitude origem
   * @param {number} lon1 - Longitude origem
   * @param {number} lat2 - Latitude destino
   * @param {number} lon2 - Longitude destino
   * @returns {Promise<{duration: number, distance: number}>} Duração em segundos e distância em metros
   */
  calcularETADinamico: async (lat1, lon1, lat2, lon2) => {
    try {
      // Usar servidor OSRM público (pode ser configurado)
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving-hgv/${lon1},${lat1};${lon2},${lat2}?overview=false`;
      
      const response = await axios.get(osrmUrl, {
        headers: {
          'User-Agent': 'DivulgaCarga/1.0 (contact: sistema@divulgacarga.com.br)'
        },
        timeout: 10000 // 10 segundos
      });

      if (response.data && response.data.routes && response.data.routes.length > 0) {
        const route = response.data.routes[0];
        return {
          duration: route.duration, // em segundos
          distance: route.distance // em metros
        };
      }

      return null;
    } catch (err) {
      console.warn('Erro ao calcular ETA dinâmico:', err.message);
      return null;
    }
  },

  /**
   * Verificar se viagem está atrasada (com ETA dinâmico)
   */
  verificarAtraso: async (idViagem, pool) => {
    try {
      // Buscar dados da viagem
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .query(`
          SELECT 
            v.IDVIAGEM,
            v.DTPREVFINAL AS DHENTREGA,
            v.CDSITUACAOVIAGEM,
            v.IDROTEIRO,
            r.CDCIDADEORIGEM,
            r.CDCIDADEDESTINO
          FROM [dbo].[VIAGEMMESTRE] v
          LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
          WHERE v.IDVIAGEM = @idviagem
            AND v.CDSITUACAOVIAGEM IN (
              SELECT CDSITUACAOVIAGEM 
              FROM [dbo].[SITUACAOVIAGEM] 
              WHERE UPPER(DSSITUACAOVIAGEM) LIKE '%ANDAMENTO%' 
                 OR UPPER(DSSITUACAOVIAGEM) LIKE '%CONFIRMADA%'
            )
            AND v.DTPREVFINAL IS NOT NULL
        `);

      if (result.recordset.length > 0) {
        const viagem = result.recordset[0];
        
        // Buscar última posição GPS separadamente
        const ultimaPosResult = await pool.request()
          .input('idviagem', sql.Decimal(15, 0), idViagem)
          .query(`
            SELECT TOP 1 
              LATITUDE, LONGITUDE, DHREGISTRO, VELOCIDADE
            FROM [dbo].[VIAGEMRASTREAMENTO] 
            WHERE IDVIAGEM = @idviagem 
            ORDER BY DHREGISTRO DESC
          `);
        
        const ultimaPos = ultimaPosResult.recordset.length > 0 ? ultimaPosResult.recordset[0] : null;
        
        // Buscar coordenadas de origem e destino de ROTEIROPONTOS
        let origemLat = null, origemLon = null, destinoLat = null, destinoLon = null;
        if (viagem.IDROTEIRO) {
          const pontosResult = await pool.request()
            .input('idroteiro', sql.Decimal(15, 0), viagem.IDROTEIRO)
            .query(`
              SELECT LATITUDE, LONGITUDE, TPLOCAL
              FROM [dbo].[ROTEIROPONTOS]
              WHERE IDROTEIRO = @idroteiro
                AND LATITUDE IS NOT NULL
                AND LONGITUDE IS NOT NULL
              ORDER BY 
                CASE TPLOCAL
                  WHEN 'O' THEN 1
                  WHEN 'D' THEN 2
                  ELSE 3
                END,
                ORDEM, SEQUENCIA
            `);
          
          if (pontosResult.recordset.length > 0) {
            const pontoOrigem = pontosResult.recordset.find(p => p.TPLOCAL === 'O') || pontosResult.recordset[0];
            const pontoDestino = pontosResult.recordset.find(p => p.TPLOCAL === 'D') || pontosResult.recordset[pontosResult.recordset.length - 1];
            
            origemLat = pontoOrigem ? pontoOrigem.LATITUDE : null;
            origemLon = pontoOrigem ? pontoOrigem.LONGITUDE : null;
            destinoLat = pontoDestino ? pontoDestino.LATITUDE : null;
            destinoLon = pontoDestino ? pontoDestino.LONGITUDE : null;
          }
        }
        
        if (ultimaPos && viagem.DHENTREGA && ultimaPos.LATITUDE && ultimaPos.LONGITUDE) {
          const agora = new Date();
          const prazo = new Date(viagem.DHENTREGA);
          const ultimaPosDate = new Date(ultimaPos.DHREGISTRO);
          
          // Se última posição foi há menos de 1 hora (não é offline)
          if ((agora - ultimaPosDate) < 3600000) {
            // Calcular ETA dinâmico se tiver coordenadas de destino
            let etaMinutos = null;
            let usandoETADinamico = false;

            if (destinoLat && destinoLon) {
              const eta = await alertService.calcularETADinamico(
                ultimaPos.LATITUDE,
                ultimaPos.LONGITUDE,
                destinoLat,
                destinoLon
              );

              if (eta && eta.duration) {
                etaMinutos = Math.ceil(eta.duration / 60); // Converter segundos para minutos
                usandoETADinamico = true;
              }
            }

            // Se não conseguiu calcular ETA dinâmico, usar cálculo simples baseado em distância
            if (!etaMinutos && destinoLat && destinoLon) {
              // Calcular distância em linha reta (Haversine)
              const distancia = alertService.calcularDistanciaHaversine(
                ultimaPos.LATITUDE,
                ultimaPos.LONGITUDE,
                destinoLat,
                destinoLon
              );
              
              // Estimar tempo baseado em velocidade média de 60 km/h
              const velocidadeMediaKmh = ultimaPos.VELOCIDADE > 0 ? ultimaPos.VELOCIDADE : 60;
              etaMinutos = Math.ceil((distancia / 1000) / (velocidadeMediaKmh / 60));
            }

            // Verificar se está atrasado
            const chegadaEstimada = new Date(agora.getTime() + (etaMinutos ? etaMinutos * 60000 : 0));
            const estaAtrasado = chegadaEstimada > prazo || agora > prazo;

            if (estaAtrasado) {
              const minutosAtraso = etaMinutos 
                ? Math.floor((chegadaEstimada - prazo) / 60000)
                : Math.floor((agora - prazo) / 60000);

              // Verificar se já existe alerta ativo
              const existeAlerta = await pool.request()
                .input('idviagem', sql.Decimal(15, 0), idViagem)
                .input('type', sql.NVarChar(20), 'atraso')
                .query(`
                  SELECT TOP 1 ID FROM [dbo].[ALERTS]
                  WHERE IDVIAGEM = @idviagem
                    AND TYPE = @type
                    AND RESOLVED = 0
                `);

              if (existeAlerta.recordset.length === 0) {
                return {
                  idviagem: idViagem,
                  type: 'atraso',
                  message: `Viagem ${etaMinutos ? `chegará ${minutosAtraso > 0 ? minutosAtraso + ' minutos' : 'no prazo'}` : 'atrasada'} ${etaMinutos ? 'após' : 'em'} ${Math.abs(minutosAtraso)} minutos`,
                  severity: Math.abs(minutosAtraso) > 120 ? 'high' : 'medium',
                  details: JSON.stringify({
                    minutosAtraso: minutosAtraso,
                    prazoEntrega: viagem.DHENTREGA,
                    etaMinutos: etaMinutos,
                    usandoETADinamico: usandoETADinamico
                  })
                };
              }
            }
          }
        }
      }

      return null;
    } catch (err) {
      console.error('Erro ao verificar atraso:', err);
      return null;
    }
  },

  /**
   * Verificar se ETA estimado > prazo de entrega (alerta preventivo)
   */
  verificarETAPrazo: async (idViagem, pool) => {
    try {
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .query(`
          SELECT 
            v.IDVIAGEM,
            v.DTPREVFINAL AS DHENTREGA,
            v.IDROTEIRO,
            r.CDCIDADEDESTINO
          FROM [dbo].[VIAGEMMESTRE] v
          LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
          WHERE v.IDVIAGEM = @idviagem
            AND v.CDSITUACAOVIAGEM IN (
              SELECT CDSITUACAOVIAGEM 
              FROM [dbo].[SITUACAOVIAGEM] 
              WHERE UPPER(DSSITUACAOVIAGEM) LIKE '%ANDAMENTO%' 
                 OR UPPER(DSSITUACAOVIAGEM) LIKE '%CONFIRMADA%'
            )
            AND v.DTPREVFINAL IS NOT NULL
        `);

      if (result.recordset.length > 0) {
        const viagem = result.recordset[0];
        
        // Buscar última posição GPS separadamente
        const ultimaPosResult = await pool.request()
          .input('idviagem', sql.Decimal(15, 0), idViagem)
          .query(`
            SELECT TOP 1 
              LATITUDE, LONGITUDE, DHREGISTRO, VELOCIDADE
            FROM [dbo].[VIAGEMRASTREAMENTO] 
            WHERE IDVIAGEM = @idviagem 
            ORDER BY DHREGISTRO DESC
          `);
        
        const ultimaPos = ultimaPosResult.recordset.length > 0 ? ultimaPosResult.recordset[0] : null;
        
        // Buscar coordenadas de destino de ROTEIROPONTOS
        let destinoLat = null, destinoLon = null;
        if (viagem.IDROTEIRO) {
          // Primeiro tentar buscar ponto com TPLOCAL = 'D'
          let pontosResult = await pool.request()
            .input('idroteiro', sql.Decimal(15, 0), viagem.IDROTEIRO)
            .query(`
              SELECT TOP 1 LATITUDE, LONGITUDE, TPLOCAL
              FROM [dbo].[ROTEIROPONTOS]
              WHERE IDROTEIRO = @idroteiro
                AND TPLOCAL = 'D'
                AND LATITUDE IS NOT NULL
                AND LONGITUDE IS NOT NULL
              ORDER BY ORDEM DESC, SEQUENCIA DESC
            `);
          
          // Se não encontrou destino marcado, pegar o último ponto por ORDEM
          if (pontosResult.recordset.length === 0) {
            pontosResult = await pool.request()
              .input('idroteiro', sql.Decimal(15, 0), viagem.IDROTEIRO)
              .query(`
                SELECT TOP 1 LATITUDE, LONGITUDE, TPLOCAL
                FROM [dbo].[ROTEIROPONTOS]
                WHERE IDROTEIRO = @idroteiro
                  AND LATITUDE IS NOT NULL
                  AND LONGITUDE IS NOT NULL
                ORDER BY ORDEM DESC, SEQUENCIA DESC
              `);
          }
          
          if (pontosResult.recordset.length > 0) {
            destinoLat = pontosResult.recordset[0].LATITUDE;
            destinoLon = pontosResult.recordset[0].LONGITUDE;
          }
        }
        
        if (ultimaPos && viagem.DHENTREGA && ultimaPos.LATITUDE && ultimaPos.LONGITUDE && 
            destinoLat && destinoLon) {
          const agora = new Date();
          const prazo = new Date(viagem.DHENTREGA);
          const ultimaPosDate = new Date(ultimaPos.DHREGISTRO);
          
          // Só verificar se última posição foi há menos de 1 hora
          if ((agora - ultimaPosDate) < 3600000) {
            // Calcular ETA dinâmico
            const eta = await alertService.calcularETADinamico(
              ultimaPos.LATITUDE,
              ultimaPos.LONGITUDE,
              destinoLat,
              destinoLon
            );

            if (eta && eta.duration) {
              const etaMinutos = Math.ceil(eta.duration / 60);
              const chegadaEstimada = new Date(agora.getTime() + (etaMinutos * 60000));
              
              // Se ETA > prazo de entrega (mas ainda não passou do prazo)
              if (chegadaEstimada > prazo && agora < prazo) {
                const minutosAlemPrazo = Math.floor((chegadaEstimada - prazo) / 60000);

                // Verificar se já existe alerta ativo
                const existeAlerta = await pool.request()
                  .input('idviagem', sql.Decimal(15, 0), idViagem)
                  .input('type', sql.NVarChar(20), 'eta_prazo')
                  .query(`
                    SELECT TOP 1 ID FROM [dbo].[ALERTS]
                    WHERE IDVIAGEM = @idviagem
                      AND TYPE = @type
                      AND RESOLVED = 0
                  `);

                if (existeAlerta.recordset.length === 0) {
                  return {
                    idviagem: idViagem,
                    type: 'eta_prazo',
                    message: `ETA estimado: ${minutosAlemPrazo} minutos após o prazo de entrega`,
                    severity: minutosAlemPrazo > 60 ? 'high' : 'medium',
                    details: JSON.stringify({
                      etaMinutos: etaMinutos,
                      minutosAlemPrazo: minutosAlemPrazo,
                      prazoEntrega: viagem.DHENTREGA,
                      chegadaEstimada: chegadaEstimada.toISOString()
                    })
                  };
                }
              }
            }
          }
        }
      }

      return null;
    } catch (err) {
      console.error('Erro ao verificar ETA vs prazo:', err);
      return null;
    }
  },

  /**
   * Calcular distância usando fórmula de Haversine (linha reta)
   */
  calcularDistanciaHaversine: (lat1, lon1, lat2, lon2) => {
    const R = 6371000; // Raio da Terra em metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distância em metros
  },

  /**
   * Verificar se motorista está offline há muito tempo
   */
  verificarOffline: async (idViagem, pool) => {
    try {
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .query(`
          SELECT TOP 1
            DHREGISTRO,
            DATEDIFF(MINUTE, DHREGISTRO, GETDATE()) as minutosOffline
            FROM [dbo].[VIAGEMRASTREAMENTO]
          WHERE IDVIAGEM = @idviagem
          ORDER BY DHREGISTRO DESC
        `);

      if (result.recordset.length > 0) {
        const data = result.recordset[0];
        
        // Se offline há mais de 90 minutos E viagem está em andamento
        if (data.minutosOffline >= 90) {
          const viagemAtiva = await pool.request()
            .input('idviagem', sql.Decimal(15, 0), idViagem)
            .query(`
              SELECT CDSITUACAOVIAGEM 
              FROM [dbo].[VIAGEMMESTRE] v
              WHERE IDVIAGEM = @idviagem
                AND EXISTS (
                  SELECT 1 
                  FROM [dbo].[SITUACAOVIAGEM] s
                  WHERE s.CDSITUACAOVIAGEM = v.CDSITUACAOVIAGEM
                    AND (UPPER(s.DSSITUACAOVIAGEM) LIKE '%ANDAMENTO%' 
                      OR UPPER(s.DSSITUACAOVIAGEM) LIKE '%CONFIRMADA%')
                )
            `);

          if (viagemAtiva.recordset.length > 0) {
            // Verificar se já existe alerta ativo
            const existeAlerta = await pool.request()
              .input('idviagem', sql.Decimal(15, 0), idViagem)
              .input('type', sql.NVarChar(20), 'offline')
              .query(`
                SELECT TOP 1 ID FROM [dbo].[ALERTS]
                WHERE IDVIAGEM = @idviagem
                  AND TYPE = @type
                  AND RESOLVED = 0
              `);

            if (existeAlerta.recordset.length === 0) {
              return {
                idviagem: idViagem,
                type: 'offline',
                message: `Motorista offline há ${data.minutosOffline} minutos`,
                severity: data.minutosOffline > 180 ? 'high' : 'medium',
                details: JSON.stringify({
                  minutosOffline: data.minutosOffline,
                  ultimaPosicao: data.DHREGISTRO
                })
              };
            }
          }
        }
      }

      return null;
    } catch (err) {
      console.error('Erro ao verificar offline:', err);
      return null;
    }
  },

  /**
   * Verificar desvio de rota (buffer de 500m)
   * Verifica se a posição atual está fora do buffer de 500m da rota planejada
   */
  verificarDesvioRota: async (idViagem, pool) => {
    try {
      // Buscar roteiro
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .query(`
          SELECT 
            v.IDVIAGEM,
            v.IDROTEIRO,
            r.CDCIDADEORIGEM,
            r.CDCIDADEDESTINO
          FROM [dbo].[VIAGEMMESTRE] v
          LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
          WHERE v.IDVIAGEM = @idviagem
            AND v.CDSITUACAOVIAGEM IN (
              SELECT CDSITUACAOVIAGEM 
              FROM [dbo].[SITUACAOVIAGEM] 
              WHERE UPPER(DSSITUACAOVIAGEM) LIKE '%ANDAMENTO%' 
                 OR UPPER(DSSITUACAOVIAGEM) LIKE '%CONFIRMADA%'
            )
        `);

      if (result.recordset.length > 0) {
        const viagem = result.recordset[0];
        
        // Buscar última posição GPS separadamente
        const ultimaPosResult = await pool.request()
          .input('idviagem', sql.Decimal(15, 0), idViagem)
          .query(`
            SELECT TOP 1 
              LATITUDE, LONGITUDE, DHREGISTRO
            FROM [dbo].[VIAGEMRASTREAMENTO] 
            WHERE IDVIAGEM = @idviagem 
            ORDER BY DHREGISTRO DESC
          `);
        
        const ultimaPos = ultimaPosResult.recordset.length > 0 ? ultimaPosResult.recordset[0] : null;
        
        if (!ultimaPos || !ultimaPos.LATITUDE || !ultimaPos.LONGITUDE) {
          return null; // Sem posição GPS
        }
        
        // Buscar coordenadas de origem e destino de ROTEIROPONTOS
        let origemLat = null, origemLon = null, destinoLat = null, destinoLon = null;

        // Buscar pontos de rota se houver roteiro
        let pontosRota = [];
        if (viagem.IDROTEIRO) {
          const pontosResult = await pool.request()
            .input('idroteiro', sql.Decimal(15, 0), viagem.IDROTEIRO)
            .query(`
              SELECT LATITUDE, LONGITUDE, SEQUENCIA, TPLOCAL
              FROM [dbo].[ROTEIROPONTOS]
              WHERE IDROTEIRO = @idroteiro
                AND LATITUDE IS NOT NULL
                AND LONGITUDE IS NOT NULL
              ORDER BY ORDEM, SEQUENCIA
            `);
          pontosRota = pontosResult.recordset;
          
          // Extrair origem e destino dos pontos
          if (pontosRota.length > 0) {
            const pontoOrigem = pontosRota.find(p => p.TPLOCAL === 'O') || pontosRota[0];
            const pontoDestino = pontosRota.find(p => p.TPLOCAL === 'D') || pontosRota[pontosRota.length - 1];
            
            origemLat = pontoOrigem ? pontoOrigem.LATITUDE : null;
            origemLon = pontoOrigem ? pontoOrigem.LONGITUDE : null;
            destinoLat = pontoDestino ? pontoDestino.LATITUDE : null;
            destinoLon = pontoDestino ? pontoDestino.LONGITUDE : null;
          }
        }

        let distanciaMinima = Infinity;

        if (pontosRota.length > 0) {
          // Tem pontos de rota - verificar distância mínima até qualquer ponto
          for (const ponto of pontosRota) {
            const distancia = alertService.calcularDistanciaHaversine(
              ultimaPos.LATITUDE,
              ultimaPos.LONGITUDE,
              ponto.LATITUDE,
              ponto.LONGITUDE
            );
            
            if (distancia < distanciaMinima) {
              distanciaMinima = distancia;
            }
          }
        } else if (origemLat && origemLon && destinoLat && destinoLon) {
          // Sem pontos de rota, usar origem e destino
          // Calcular distância mínima da linha origem-destino
          const distancia = alertService.distanciaParaLinha(
            ultimaPos.LATITUDE,
            ultimaPos.LONGITUDE,
            origemLat,
            origemLon,
            destinoLat,
            destinoLon
          );
          distanciaMinima = distancia;
        }

        // Se está fora do buffer de 500m
        if (distanciaMinima > 500 && distanciaMinima !== Infinity) {
          // Verificar se já existe alerta ativo
          const existeAlerta = await pool.request()
            .input('idviagem', sql.Decimal(15, 0), idViagem)
            .input('type', sql.NVarChar(20), 'desvio')
            .query(`
              SELECT TOP 1 ID FROM [dbo].[ALERTS]
              WHERE IDVIAGEM = @idviagem
                AND TYPE = @type
                AND RESOLVED = 0
            `);

          if (existeAlerta.recordset.length === 0) {
            return {
              idviagem: idViagem,
              type: 'desvio',
              message: `Desvio de rota detectado: ${Math.round(distanciaMinima)}m fora do trajeto planejado`,
              severity: distanciaMinima > 2000 ? 'high' : 'medium',
              details: JSON.stringify({
                distanciaMetros: Math.round(distanciaMinima),
                posicaoAtual: {
                  lat: ultimaPos.LATITUDE,
                  lon: ultimaPos.LONGITUDE
                }
              })
            };
          }
        }
      }

      return null;
    } catch (err) {
      console.error('Erro ao verificar desvio de rota:', err);
      return null;
    }
  },

  /**
   * Calcular distância de um ponto até uma linha (segmento)
   * Usa fórmula de distância ponto-reta
   */
  distanciaParaLinha: (latP, lonP, lat1, lon1, lat2, lon2) => {
    // Converter para radianos
    const R = 6371000; // Raio da Terra em metros
    
    const dLat1 = (lat1 - latP) * Math.PI / 180;
    const dLon1 = (lon1 - lonP) * Math.PI / 180;
    const dLat2 = (lat2 - latP) * Math.PI / 180;
    const dLon2 = (lon2 - lonP) * Math.PI / 180;
    
    // Distância do ponto até origem e destino
    const dist1 = R * Math.sqrt(dLat1 * dLat1 + dLon1 * dLon1 * Math.cos(latP * Math.PI / 180) * Math.cos(latP * Math.PI / 180));
    const dist2 = R * Math.sqrt(dLat2 * dLat2 + dLon2 * dLon2 * Math.cos(latP * Math.PI / 180) * Math.cos(latP * Math.PI / 180));
    
    // Distância entre origem e destino
    const dLatSeg = (lat2 - lat1) * Math.PI / 180;
    const dLonSeg = (lon2 - lon1) * Math.PI / 180;
    const distSeg = R * Math.sqrt(dLatSeg * dLatSeg + dLonSeg * dLonSeg * Math.cos(lat1 * Math.PI / 180) * Math.cos(lat1 * Math.PI / 180));
    
    // Se o segmento é muito curto, usar distância até o ponto mais próximo
    if (distSeg < 100) {
      return Math.min(dist1, dist2);
    }
    
    // Calcular distância perpendicular usando fórmula simplificada
    // Para precisão maior, seria necessário cálculo mais complexo
    // Por enquanto, usar distância até o ponto mais próximo do segmento
    return Math.min(dist1, dist2);
  },

  /**
   * Salvar alerta no banco
   */
  salvarAlerta: async (alerta, pool) => {
    try {
      // Verificar se já existe alerta ativo do mesmo tipo
      const existeResult = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), alerta.idviagem)
        .input('type', sql.NVarChar(20), alerta.type)
        .query(`
          SELECT TOP 1 ID 
          FROM [dbo].[ALERTS]
          WHERE IDVIAGEM = @idviagem
            AND TYPE = @type
            AND (STATUS IS NULL OR STATUS = 'Pendente' OR STATUS = 'Em Análise')
            AND RESOLVED = 0
        `);

      if (existeResult.recordset.length > 0) {
        console.log(`ℹ️  Alerta ${alerta.type} já existe ativo para viagem ${alerta.idviagem}, não duplicando`);
        return false; // Já existe, não duplicar
      }

      // Determinar prioridade baseado na severity
      let prioridade = 'Normal';
      if (alerta.severity === 'high') {
        prioridade = 'Urgente';
      } else if (alerta.severity === 'medium') {
        prioridade = 'Alta';
      }

      await pool.request()
        .input('idviagem', sql.Decimal(15, 0), alerta.idviagem)
        .input('cdmotorista', sql.Decimal(15, 0), alerta.cdmotorista || null)
        .input('type', sql.NVarChar(20), alerta.type.toUpperCase())
        .input('message', sql.NVarChar(255), alerta.message)
        .input('severity', sql.NVarChar(10), alerta.severity)
        .input('prioridade', sql.NVarChar(20), prioridade)
        .input('details', sql.NVarChar(sql.MAX), alerta.details || null)
        .query(`
          INSERT INTO [dbo].[ALERTS] (
            IDVIAGEM, CDMOTORISTA, TYPE, MESSAGE, SEVERITY, PRIORIDADE, DETAILS, STATUS
          )
          VALUES (
            @idviagem, @cdmotorista, @type, @message, @severity, @prioridade, @details, 'Pendente'
          )
        `);

      return true;
    } catch (err) {
      console.error('❌ Erro ao salvar alerta:', err.message);
      console.error('   Detalhes:', {
        idviagem: alerta.idviagem,
        type: alerta.type,
        message: alerta.message
      });
      return false;
    }
  },

  /**
   * Buscar alertas ativos de uma viagem
   */
  buscarAlertasAtivos: async (idViagem) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .query(`
          SELECT 
            ID,
            IDVIAGEM,
            TYPE,
            MESSAGE,
            SEVERITY,
            DETAILS,
            CREATED_AT,
            RESOLVED
          FROM [dbo].[ALERTS]
          WHERE IDVIAGEM = @idviagem
            AND RESOLVED = 0
          ORDER BY 
            CASE SEVERITY
              WHEN 'high' THEN 1
              WHEN 'medium' THEN 2
              WHEN 'low' THEN 3
            END,
            CREATED_AT DESC
        `);

      return result.recordset;
    } catch (err) {
      console.error('Erro ao buscar alertas:', err);
      return [];
    }
  },

  /**
   * Buscar alerta por ID
   */
  buscarAlertaPorId: async (idAlerta) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request()
        .input('id', sql.Int, idAlerta)
        .query(`
          SELECT TOP 1
            ID,
            IDVIAGEM,
            CDMOTORISTA,
            TYPE,
            MESSAGE,
            SEVERITY,
            DETAILS,
            CREATED_AT,
            RESOLVED,
            RESOLVED_AT,
            RESOLVED_BY
          FROM [dbo].[ALERTS]
          WHERE ID = @id
        `);

      return result.recordset.length > 0 ? result.recordset[0] : null;
    } catch (err) {
      console.error('Erro ao buscar alerta:', err);
      return null;
    }
  },

  /**
   * Marcar alerta como resolvido
   */
  resolverAlerta: async (idAlerta, idUsuario) => {
    try {
      const pool = await poolPromise;
      await pool.request()
        .input('id', sql.Int, idAlerta)
        .input('idusuario', sql.Int, idUsuario || null)
        .query(`
          UPDATE [dbo].[ALERTS]
          SET 
            RESOLVED = 1,
            RESOLVED_AT = GETDATE(),
            RESOLVED_BY = @idusuario
          WHERE ID = @id
        `);

      return true;
    } catch (err) {
      console.error('Erro ao resolver alerta:', err);
      return false;
    }
  }
};

module.exports = alertService;
