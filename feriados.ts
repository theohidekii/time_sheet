export interface FeriadoItem {
  data: string; // DD/MM/YYYY
  descricao: string;
}

const fmt = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)
function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

/** Feriados nacionais do ano (Carnaval e Corpus Christi são ponto facultativo e ficam de fora). */
export function feriadosNacionais(ano: number): FeriadoItem[] {
  const p = pascoa(ano);
  const sextaSanta = new Date(p.getFullYear(), p.getMonth(), p.getDate() - 2);
  const fixos: [number, number, string][] = [
    [1, 1, 'Confraternização Universal'],
    [21, 4, 'Tiradentes'],
    [1, 5, 'Dia do Trabalho'],
    [7, 9, 'Independência do Brasil'],
    [12, 10, 'Nossa Senhora Aparecida'],
    [2, 11, 'Finados'],
    [15, 11, 'Proclamação da República'],
    [25, 12, 'Natal'],
  ];
  if (ano >= 2024) fixos.push([20, 11, 'Consciência Negra']);
  return [
    ...fixos.map(([d, m, descricao]) => ({ data: fmt(new Date(ano, m - 1, d)), descricao })),
    { data: fmt(sextaSanta), descricao: 'Sexta-feira Santa' },
  ].sort((x, y) => {
    const [dx, mx] = x.data.split('/').map(Number);
    const [dy, my] = y.data.split('/').map(Number);
    return mx - my || dx - dy;
  });
}
