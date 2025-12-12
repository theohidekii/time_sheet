export interface Funcionario {
  id: string;
  nome: string;
  pis: string;
  pisAdicionais?: string[];
}

export interface MarcacaoPonto {
  id: string;
  nsr: string;
  funcionarioId: string;
  funcionarioNome: string;
  pis: string;
  nomeFuncionario: string;
  data: string; // DD/MM/YYYY
  hora: string; // HH:MM
  tipo: string;
  crc: string;
  manual?: boolean; // Flag to indicate if it was edited manually
}

export interface PontoFaltante {
  tipo: string;
  horarioEsperado: string;
  motivo: string;
}

export interface DiaTrabalho {
  id: string; // Unique ID for React keys
  data: string; // DD/MM/YYYY
  diaSemana?: string;
  funcionarioId: string;
  funcionarioNome: string;
  marcacoes: MarcacaoPonto[];
  totalHorasTrabalhadas: number; // minutes
  totalHorasAlmoco: number; // minutes
  horasExtras: number; // minutes
  atrasos: number; // minutes
  saldoDia: number; // minutes (Positive or Negative - Net Balance)
  saidasAntecipadas: number; // minutes
  observacoes: string[];
  pontosFaltantes?: PontoFaltante[];
  atestado?: boolean; // New field for Medical Certificate
}

export interface ConfiguracaoSistema {
  horarioPadraoEntrada: string;
  horarioPadraoSaida: string;
  horarioAlmocoInicio: string;
  horarioAlmocoFim: string;
  toleranciaAtraso: number;
  toleranciaSaida: number;
  jornadaDiaria: string; // HH:MM (Expected daily hours)
  tiposSaidaEspecial: string[];
  almocoDuracaoMinutos: number;
  exigirAlmoco: boolean; // New field to control lunch validation
}