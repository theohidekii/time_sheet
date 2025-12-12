import { MarcacaoPonto, Funcionario, DiaTrabalho, ConfiguracaoSistema, PontoFaltante } from './types';

// Simple UUID generator for browser environment
function uuidv4(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Parser especializado para o layout do arquivo AFD.
 */
export class AFDParserV2 {
  private funcionariosPorPis: Map<string, Funcionario> = new Map();
  private funcionariosPorNome: Map<string, Funcionario> = new Map();
  private marcacoes: MarcacaoPonto[] = [];
  public configuracao: ConfiguracaoSistema;

  constructor(configuracao?: ConfiguracaoSistema) {
    this.configuracao = configuracao || {
      horarioPadraoEntrada: '08:00',
      horarioPadraoSaida: '17:48', // Ajustado para fechar com a jornada de 8:48
      horarioAlmocoInicio: '12:00',
      horarioAlmocoFim: '13:00',
      toleranciaAtraso: 10,
      toleranciaSaida: 5,
      jornadaDiaria: '08:48', // PADRÃO 44H SEMANAIS (44/5 = 8.8h = 8h48min)
      tiposSaidaEspecial: ['Atestado Médico', 'Consulta Médica', 'Banco de Horas', 'Férias', 'Folga'],
      almocoDuracaoMinutos: 60,
      exigirAlmoco: true
    };
  }

  public updateConfig(newConfig: ConfiguracaoSistema) {
    this.configuracao = newConfig;
  }

  private normalizarNome(nome: string): string {
    return (nome || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
  }

  /**
   * Lê todo o conteúdo e retorna funcionários e marcações
   */
  parseAFDContent(content: string): { funcionarios: Funcionario[]; marcacoes: MarcacaoPonto[] } {
    this.funcionariosPorPis.clear();
    this.funcionariosPorNome.clear();
    this.marcacoes = [];

    const lines = content.split(/\r?\n/);

    // 1) Varredura de funcionários
    for (const line of lines) {
      const match = this.extrairFuncionarioLinha(line);
      if (!match) continue;
      const { pisKey, nome } = match;
      const nomeNorm = this.normalizarNome(nome);

      // (Logic for deduplicating employees based on names/prefixes from user code)
      if (/^[IAE][A-ZÀ-Ÿ]/.test(nomeNorm)) {
        const base = nomeNorm.slice(1);
        if (this.funcionariosPorNome.has(base)) {
          const existenteBase = this.funcionariosPorNome.get(base)!;
          if (existenteBase.pis !== pisKey) {
            existenteBase.pisAdicionais = existenteBase.pisAdicionais || [];
            if (!existenteBase.pisAdicionais.includes(pisKey)) {
              existenteBase.pisAdicionais.push(pisKey);
            }
          }
          this.funcionariosPorPis.set(pisKey, existenteBase);
          this.funcionariosPorPis.set(pisKey.padStart(11, '0'), existenteBase);
          continue;
        }
      }

      if (this.funcionariosPorNome.has(nomeNorm)) {
        const existente = this.funcionariosPorNome.get(nomeNorm)!;
        if (existente.pis !== pisKey) {
            existente.pisAdicionais = existente.pisAdicionais || [];
            if (!existente.pisAdicionais.includes(pisKey)) {
                existente.pisAdicionais.push(pisKey);
            }
            this.funcionariosPorPis.set(pisKey, existente);
        }
        continue;
      }

      let funcionarioSimilar = null;
      for (const [_, func] of this.funcionariosPorNome) {
        if (this.saoPisVariacoes(func.pis, pisKey)) {
          funcionarioSimilar = func;
          break;
        }
      }

      if (funcionarioSimilar) {
        if (funcionarioSimilar.pis !== pisKey) {
            funcionarioSimilar.pisAdicionais = funcionarioSimilar.pisAdicionais || [];
            if (!funcionarioSimilar.pisAdicionais.includes(pisKey)) {
                funcionarioSimilar.pisAdicionais.push(pisKey);
            }
        }
        this.funcionariosPorPis.set(pisKey, funcionarioSimilar);
        this.funcionariosPorPis.set(pisKey.padStart(11, '0'), funcionarioSimilar);
        continue;
      }

      const funcionario: Funcionario = {
        id: pisKey,
        nome,
        pis: pisKey,
        pisAdicionais: []
      };
      this.funcionariosPorPis.set(pisKey, funcionario);
      this.funcionariosPorPis.set(pisKey.padStart(11, '0'), funcionario);
      this.funcionariosPorNome.set(nomeNorm, funcionario);
    }

    // 2) Varredura de marcações
    for (const line of lines) {
      const marc = this.extrairMarcacaoLinha(line);
      if (!marc) continue;

      let funcionario = this.funcionariosPorPis.get(marc.pisKey) || 
                       this.funcionariosPorPis.get(marc.pisRaw) || 
                       this.funcionariosPorPis.get(marc.pisRaw.padStart(11, '0')) ||
                       this.funcionariosPorPis.get(marc.pisKey.padStart(11, '0'));
      
      if (!funcionario) {
        for (const [_, func] of this.funcionariosPorPis) {
          if (func.pisAdicionais && func.pisAdicionais.includes(marc.pisKey)) {
            funcionario = func;
            break;
          }
        }
      }

      if (!funcionario) {
        for (const [pisKey, func] of this.funcionariosPorPis) {
          if (this.saoPisVariacoes(pisKey, marc.pisKey)) {
            funcionario = func;
            break;
          }
        }
      }
      
      const funcionarioNome = funcionario?.nome || '';

      const marcacao: MarcacaoPonto = {
        id: uuidv4(),
        nsr: marc.nsr,
        funcionarioId: funcionario ? funcionario.pis : marc.pisKey,
        funcionarioNome,
        pis: marc.pisKey,
        nomeFuncionario: funcionarioNome,
        data: marc.data,
        hora: marc.hora,
        tipo: 'outro',
        crc: ''
      };

      this.marcacoes.push(marcacao);
    }

    const funcionariosConsolidados = this.consolidarFuncionariosPorNome();
    
    return {
      funcionarios: funcionariosConsolidados,
      marcacoes: this.marcacoes
    };
  }

  private consolidarFuncionariosPorNome(): Funcionario[] {
    const funcionariosPorNomeNormalizado = new Map<string, Funcionario>();
    
    for (const [nomeNorm, funcionario] of this.funcionariosPorNome) {
      if (funcionariosPorNomeNormalizado.has(nomeNorm)) {
        const existente = funcionariosPorNomeNormalizado.get(nomeNorm)!;
        if (existente.pis !== funcionario.pis) {
          existente.pisAdicionais = existente.pisAdicionais || [];
          if (!existente.pisAdicionais.includes(funcionario.pis)) {
            existente.pisAdicionais.push(funcionario.pis);
          }
        }
        if (funcionario.pisAdicionais) {
          existente.pisAdicionais = existente.pisAdicionais || [];
          funcionario.pisAdicionais.forEach(pis => {
            if (!existente.pisAdicionais!.includes(pis)) {
              existente.pisAdicionais!.push(pis);
            }
          });
        }
      } else {
        funcionariosPorNomeNormalizado.set(nomeNorm, { ...funcionario });
      }
    }
    
    return Array.from(funcionariosPorNomeNormalizado.values());
  }

  private extrairFuncionarioLinha(line: string): { pisKey: string; nome: string } | null {
    if (!line) return null;
    const match = line.match(/^(\d{9})(\d{1})(\d{8})(\d{4})([IAE])(\d{11})(.*)/);
    
    if (!match) return null;
    
    const pisRaw = match[6];
    let nome = match[7];
    
    const pisKey = pisRaw.substring(1);
    if (!pisKey || pisKey.length !== 10) return null;

    nome = nome.replace(/\s+/g, ' ').trim();
    nome = nome.replace(/^\d+/, '');
    nome = nome.replace(/\d{10,}$/, '');
    nome = nome.replace(/[^A-Za-zÀ-ÿ'\-\s]/g, '').trim();
    
    if (!nome || nome.length < 3) return null;
    if (/^0{10}$/.test(pisKey)) return null;
    
    return { pisKey, nome };
  }

  private saoPisVariacoes(pis1: string, pis2: string): boolean {
    if (pis1 === pis2) return true;
    if (pis1.length === pis2.length && pis1.length === 10) {
      const rotacao1 = pis1 + pis1;
      if (rotacao1.includes(pis2)) return true;
      const rotacao2 = pis2 + pis2;
      if (rotacao2.includes(pis1)) return true;
      let diferencas = 0;
      for (let i = 0; i < 10; i++) {
        if (pis1[i] !== pis2[i]) diferencas++;
      }
      if (diferencas <= 3) return true;
    }
    return false;
  }

  private extrairMarcacaoLinha(line: string): { nsr: string; data: string; hora: string; pisRaw: string; pisKey: string } | null {
    if (!line) return null;
    const match = line.match(/^(\d{9})3(\d{8})(\d{4})(\d{11})/);
    if (!match || line.length < 33) return null;
    
    const nsr = match[1];
    const data = match[2];
    const hora = match[3];
    const pisRaw = match[4];
    
    const pisKey = pisRaw.substring(1);
    if (!pisKey || pisKey.length !== 10) return null;
    if (!data || data.length !== 8) return null;
    if (!hora || hora.length !== 4) return null;
    
    const dia = parseInt(data.substring(0, 2));
    const mes = parseInt(data.substring(2, 4));
    const ano = parseInt(data.substring(4, 8));
    
    if (isNaN(dia) || isNaN(mes) || isNaN(ano) || dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
    
    const dataFormatada = `${dia.toString().padStart(2, '0')}/${mes.toString().padStart(2, '0')}/${ano.toString().padStart(4, '0')}`;
    
    const horas = parseInt(hora.substring(0, 2));
    const minutos = parseInt(hora.substring(2, 4));
    if (isNaN(horas) || isNaN(minutos) || horas < 0 || horas > 23 || minutos < 0 || minutos > 59) return null;
    const horaFormatada = `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;

    return { nsr, data: dataFormatada, hora: horaFormatada, pisRaw, pisKey };
  }

  public horaParaMinutos(h: string): number {
    const [hh, mm] = h.split(':').map(Number);
    return hh * 60 + mm;
  }

  public calcularHorariosDia(dia: DiaTrabalho, configOverride?: ConfiguracaoSistema) {
    const config = configOverride || this.configuracao;

    // Se tiver atestado, zera as faltas, zera saldo (dia considerado trabalhado ou abonado)
    if (dia.atestado) {
        dia.pontosFaltantes = [];
        dia.observacoes = [...dia.observacoes.filter(o => o !== "ATESTADO MÉDICO"), "ATESTADO MÉDICO"];
        dia.horasExtras = 0;
        dia.atrasos = 0;
        dia.saidasAntecipadas = 0;
        dia.saldoDia = 0; // Considera neutro para o banco
        return;
    }

    // Definição de Jornada Esperada para Banco de Horas (44h Semanais)
    // Seg-Sex: Esperado "config.jornadaDiaria" (Padrão 08:48)
    // Sáb-Dom: Esperado 0 (Tudo é extra)
    const isFimDeSemana = dia.diaSemana === 'Sábado' || dia.diaSemana === 'Domingo';
    const jornadaEsperadaMinutos = isFimDeSemana ? 0 : this.horaParaMinutos(config.jornadaDiaria || '08:48');

    if (!dia.marcacoes || dia.marcacoes.length === 0) {
        dia.totalHorasTrabalhadas = 0;
        dia.totalHorasAlmoco = 0;
        dia.saidasAntecipadas = 0;
        
        if (!isFimDeSemana) {
            this.detectarPontosFaltantes(dia, config);
            // Falta Integral
            dia.atrasos = jornadaEsperadaMinutos;
            dia.saldoDia = -jornadaEsperadaMinutos;
            dia.horasExtras = 0;
        } else {
            // Fim de semana sem trabalho: Zero a zero
            dia.atrasos = 0;
            dia.saldoDia = 0;
            dia.horasExtras = 0;
        }
        return;
    }

    // Ordenar marcações cronologicamente
    dia.marcacoes.sort((a, b) => a.hora.localeCompare(b.hora));
    
    // Detectar pontos faltantes (marcações ímpares, almoço curto, etc)
    this.detectarPontosFaltantes(dia, config);
    
    // --- 1. Cálculo do Total Trabalhado (Minutos Reais) ---
    let totalTrabalhado = 0;
    
    // Itera em pares (E1-S1, E2-S2...)
    for (let i = 0; i < dia.marcacoes.length - 1; i += 2) {
      const entrada = dia.marcacoes[i];
      const saida = dia.marcacoes[i + 1];
      if (!entrada || !saida) continue;
      
      const ini = this.horaParaMinutos(entrada.hora);
      const fim = this.horaParaMinutos(saida.hora);
      
      let diff = fim - ini;
      if (diff < 0) diff += 24 * 60; 
      
      totalTrabalhado += diff;
    }

    // --- 2. Cálculo do Intervalo de Almoço (Informativo) ---
    if (config.exigirAlmoco && dia.marcacoes.length >= 4) {
        const s1 = this.horaParaMinutos(dia.marcacoes[1].hora);
        const e2 = this.horaParaMinutos(dia.marcacoes[2].hora);
        let almoco = e2 - s1;
        if (almoco < 0) almoco += 24 * 60;
        dia.totalHorasAlmoco = almoco;
    } else {
        dia.totalHorasAlmoco = 0;
    }

    dia.totalHorasTrabalhadas = totalTrabalhado;

    // --- 3. Cálculo de Saldo (Banco de Horas) ---
    // O Saldo é simplesmente o que trabalhou menos o que devia trabalhar naquele dia.
    // Ex: Trabalhou 8h (480m). Devia 8:48 (528m). Saldo = -48m.
    // Ex: Trabalhou Sábado 4h (240m). Devia 0. Saldo = +240m.
    const saldo = totalTrabalhado - jornadaEsperadaMinutos;
    const tolerancia = config.toleranciaAtraso || 10;

    dia.saldoDia = saldo;

    // Preencher campos legados (Extras/Atrasos) para visualização na tabela diária, aplicando tolerância
    if (saldo > 0) {
        // Se exceder tolerância, é extra. Se não, considera zero (ou o próprio saldo, dependendo da regra da empresa).
        // Para banco de horas estrito, cada minuto conta. Vamos registrar tudo se passar da tolerância.
        if (saldo > tolerancia) {
            dia.horasExtras = saldo;
            dia.atrasos = 0;
        } else {
            // Dentro da tolerância
            dia.horasExtras = 0;
            dia.atrasos = 0;
            // Opcional: zerar o saldoDia se a empresa não computa tolerância no banco
            // dia.saldoDia = 0; 
        }
    } else if (saldo < 0) {
        const debito = Math.abs(saldo);
        if (debito > tolerancia) {
            dia.atrasos = debito;
            dia.horasExtras = 0;
        } else {
            dia.atrasos = 0;
            dia.horasExtras = 0;
            // dia.saldoDia = 0;
        }
    } else {
        dia.horasExtras = 0;
        dia.atrasos = 0;
    }

    // --- 4. Saídas Antecipadas (Indicador) ---
    dia.saidasAntecipadas = 0;
    if (!isFimDeSemana && dia.marcacoes.length > 0 && dia.marcacoes.length % 2 === 0) {
        const ultimaSaida = dia.marcacoes[dia.marcacoes.length - 1];
        const horarioSaidaPadrao = this.horaParaMinutos(config.horarioPadraoSaida);
        const horaSaidaReal = this.horaParaMinutos(ultimaSaida.hora);
        
        if (horaSaidaReal < horarioSaidaPadrao && saldo < -tolerancia) {
             const diffSaida = horarioSaidaPadrao - horaSaidaReal;
             dia.saidasAntecipadas = Math.min(diffSaida, Math.abs(saldo));
        }
    }
  }

  private detectarPontosFaltantes(dia: DiaTrabalho, config: ConfiguracaoSistema) {
    const pontosFaltantes: PontoFaltante[] = [];
    
    const [dd, mm, yyyy] = dia.data.split('/').map(n => parseInt(n));
    const d = new Date(yyyy, (mm || 1) - 1, dd || 1);
    const isDomingo = d.getDay() === 0;

    if (isDomingo) return; 

    const marcacoes = dia.marcacoes;
    const { horarioAlmocoInicio, horarioAlmocoFim } = config;

    if (marcacoes.length === 0) {
        pontosFaltantes.push({ tipo: 'Geral', horarioEsperado: 'Dia Completo', motivo: 'Falta Integral' });
        dia.pontosFaltantes = pontosFaltantes;
        return;
    }

    if (marcacoes.length % 2 !== 0) {
        pontosFaltantes.push({ tipo: 'Saída', horarioEsperado: '---', motivo: 'Batida ímpar (falta saída)' });
    }

    if (config.exigirAlmoco) {
      const isSabado = d.getDay() === 6;
      if (!isSabado && marcacoes.length === 2) {
          const m1 = this.horaParaMinutos(marcacoes[0].hora);
          const m2 = this.horaParaMinutos(marcacoes[1].hora);
          const almocoIni = this.horaParaMinutos(horarioAlmocoInicio);
          const almocoFim = this.horaParaMinutos(horarioAlmocoFim);
          
          if (m1 < almocoIni && m2 > almocoFim) {
               pontosFaltantes.push({ tipo: 'Intervalo', horarioEsperado: `${horarioAlmocoInicio} - ${horarioAlmocoFim}`, motivo: 'Não registrou intervalo de almoço' });
          }
      }
    }

    dia.pontosFaltantes = pontosFaltantes;
  }
}