import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Upload, FileSpreadsheet, Calendar, Clock, User, AlertCircle, Save, 
  Search, Settings, X, Check, FileText, Loader, LayoutDashboard, 
  Menu, LogOut
} from 'lucide-react';
import { AFDParserV2 } from './parser';
import { Funcionario, MarcacaoPonto, DiaTrabalho, ConfiguracaoSistema } from './types';

// Extend window for XLSX
declare global {
  interface Window {
    XLSX: any;
  }
}

// --- Components ---

const App = () => {
  // Navigation State
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // --- Timekeeping State ---
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [marcacoesRaw, setMarcacoesRaw] = useState<MarcacaoPonto[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [config, setConfig] = useState<ConfiguracaoSistema>({
    horarioPadraoEntrada: '08:00',
    horarioPadraoSaida: '17:48',
    horarioAlmocoInicio: '12:00',
    horarioAlmocoFim: '13:00',
    toleranciaAtraso: 10,
    toleranciaSaida: 5,
    jornadaDiaria: '08:48', // Padrão 44h semanais
    tiposSaidaEspecial: [],
    almocoDuracaoMinutos: 60,
    exigirAlmoco: true
  });
  const [employeeConfigs, setEmployeeConfigs] = useState<{[key: string]: ConfiguracaoSistema}>({});
  const [abonos, setAbonos] = useState<{[key: string]: boolean}>({});
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedFuncionarioId, setSelectedFuncionarioId] = useState<string | null>(null);
  const [processedDays, setProcessedDays] = useState<Map<string, DiaTrabalho[]>>(new Map());
  const [searchTerm, setSearchTerm] = useState('');

  // Parser Instance
  const parser = useMemo(() => new AFDParserV2(config), []);

  // Effects
  useEffect(() => { parser.updateConfig(config); }, [config, parser]);

  useEffect(() => {
    // Config específica para Maria das Neves
    const targetPIS = "1639622867";
    const targetEmployee = funcionarios.find(f => f.pis === targetPIS);
    if (targetEmployee) {
      setEmployeeConfigs(prev => {
        if (prev[targetEmployee.id]) return prev;
        return {
          ...prev,
          [targetEmployee.id]: {
            ...config,
            horarioPadraoEntrada: '07:00',
            horarioPadraoSaida: '16:00',
            jornadaDiaria: '08:00'
          }
        };
      });
    }
  }, [funcionarios]);

  // --- Handlers for Timekeeping ---
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setFileContent(content);
        const { funcionarios: f, marcacoes: m } = parser.parseAFDContent(content);
        setFuncionarios(f);
        setMarcacoesRaw(m);
      };
      reader.readAsText(file);
    }
  };

  const processData = () => {
    if (!startDate || !endDate || funcionarios.length === 0) { setIsProcessing(false); return; }
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) { setIsProcessing(false); return; }

    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    if (diffDays > 730) { setIsProcessing(false); return; }

    const newProcessedDays = new Map<string, DiaTrabalho[]>();
    const dateArray: string[] = [];
    for(let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
       if (dt.getDay() === 0) continue;
       const dd = String(dt.getDate()).padStart(2, '0');
       const mm = String(dt.getMonth() + 1).padStart(2, '0');
       const yyyy = dt.getFullYear();
       dateArray.push(`${dd}/${mm}/${yyyy}`);
    }

    funcionarios.forEach(func => {
      const days: DiaTrabalho[] = [];
      const funcConfig = employeeConfigs[func.id] || config;

      dateArray.forEach(dateStr => {
        const funcPISList = [func.pis, ...(func.pisAdicionais || [])];
        const punches = marcacoesRaw.filter(m => funcPISList.includes(m.pis) && m.data === dateStr);
        const dayId = `${func.id}-${dateStr}`;
        const dia: DiaTrabalho = {
          id: dayId,
          data: dateStr,
          funcionarioId: func.id,
          funcionarioNome: func.nome,
          marcacoes: punches,
          totalHorasTrabalhadas: 0,
          totalHorasAlmoco: 0,
          horasExtras: 0,
          atrasos: 0,
          saldoDia: 0,
          saidasAntecipadas: 0,
          observacoes: [],
          atestado: abonos[dayId] || false
        };
        const [dd, mm, yyyy] = dateStr.split('/').map(Number);
        const dateObj = new Date(yyyy, mm-1, dd);
        const weekDays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        dia.diaSemana = weekDays[dateObj.getDay()];
        parser.calcularHorariosDia(dia, funcConfig);
        days.push(dia);
      });
      newProcessedDays.set(func.id, days);
    });
    setProcessedDays(newProcessedDays);
    setIsProcessing(false);
  };

  useEffect(() => {
    if (fileContent && startDate && endDate) setIsProcessing(true);
    const timer = setTimeout(() => {
        if (fileContent) processData();
        else setIsProcessing(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [fileContent, startDate, endDate, config, employeeConfigs, abonos]);

  const handleTimeEdit = (dayId: string, punchIndex: number, newTime: string) => {
    if (!selectedFuncionarioId) return;
    const days = processedDays.get(selectedFuncionarioId);
    if (!days) return;
    const newDays = [...days];
    const dayIndex = newDays.findIndex(d => d.id === dayId);
    if (dayIndex === -1) return;
    const day = { ...newDays[dayIndex] };
    const marcacoes = [...day.marcacoes];

    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(newTime) && newTime !== '') return;

    if (newTime === '') {
        if (marcacoes[punchIndex]) marcacoes.splice(punchIndex, 1);
    } else {
        if (marcacoes[punchIndex]) {
            marcacoes[punchIndex] = { ...marcacoes[punchIndex], hora: newTime, manual: true };
        } else {
            marcacoes.push({
                id: `manual-${Date.now()}`,
                nsr: 'MANUAL',
                funcionarioId: day.funcionarioId,
                funcionarioNome: day.funcionarioNome,
                pis: day.funcionarioId,
                nomeFuncionario: day.funcionarioNome,
                data: day.data,
                hora: newTime,
                tipo: 'manual',
                crc: '',
                manual: true
            });
        }
    }
    day.marcacoes = marcacoes;
    const funcConfig = employeeConfigs[selectedFuncionarioId] || config;
    parser.calcularHorariosDia(day, funcConfig);
    newDays[dayIndex] = day;
    const newMap = new Map(processedDays);
    newMap.set(selectedFuncionarioId, newDays);
    setProcessedDays(newMap);
  };

  const minutesToHM = (m: number) => {
    const isNegative = m < 0;
    const absM = Math.abs(m);
    const hh = Math.floor(absM / 60);
    const mm = absM % 60;
    return `${isNegative ? '-' : ''}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  const exportToExcel = () => {
    if (!window.XLSX) { alert("Biblioteca XLSX não carregada."); return; }
    const wb = window.XLSX.utils.book_new();
    const sortedIds = Array.from(processedDays.keys())
        .filter(funcId => {
             const days = processedDays.get(funcId);
             return days && days.some(d => d.marcacoes.length > 0);
        })
        .sort((a, b) => {
            const nameA = processedDays.get(a)?.[0]?.funcionarioNome || '';
            const nameB = processedDays.get(b)?.[0]?.funcionarioNome || '';
            return nameA.localeCompare(nameB);
        });

    if (sortedIds.length === 0) { alert("Nenhum funcionário com registros."); return; }

    // Resumo Geral com Saldo Banco de Horas
    const summaryData: any[] = [
      ["Funcionário", "PIS", "Dias Trabalhados", "Horas Trabalhadas (Total)", "Saldo Banco de Horas (Total)", "Dias com Ocorrências"]
    ];

    sortedIds.forEach(funcId => {
      const days = processedDays.get(funcId)!;
      let totalTrab = 0, totalSaldo = 0, diasTrabalhados = 0, diasOcorrencias = 0;
      days.forEach(d => {
        totalTrab += d.totalHorasTrabalhadas;
        totalSaldo += d.saldoDia; // Soma algébrica do saldo (banco de horas)
        if (d.totalHorasTrabalhadas > 0 || d.atestado) diasTrabalhados++;
        if ((d.pontosFaltantes?.length || 0) > 0 && !d.atestado) diasOcorrencias++;
      });
      summaryData.push([
        days[0].funcionarioNome, days[0].funcionarioId, diasTrabalhados,
        minutesToHM(totalTrab), minutesToHM(totalSaldo), diasOcorrencias
      ]);
    });

    const wsSummary = window.XLSX.utils.aoa_to_sheet(summaryData);
    window.XLSX.utils.book_append_sheet(wb, wsSummary, "Resumo Geral");

    // Folhas Individuais
    sortedIds.forEach(funcId => {
      const days = processedDays.get(funcId)!;
      const sheetRows: any[] = [
        [`FOLHA DE PONTO: ${days[0].funcionarioNome.toUpperCase()}`],
        [`PIS: ${days[0].funcionarioId}`], [],
        ["Data", "Dia Semana", "Entrada", "Saída", "Entrada", "Saída", "Entrada", "Saída", "Trabalhado", "Saldo Dia", "Observações"]
      ];
      days.forEach(day => {
          const row: any[] = [day.data, day.diaSemana];
          for(let i=0; i<6; i++) row.push(day.marcacoes[i]?.hora || "--");
          if (day.atestado) {
            row.push("ATESTADO", "00:00", "Atestado Médico Entregue");
          } else {
            row.push(
                minutesToHM(day.totalHorasTrabalhadas), 
                minutesToHM(day.saldoDia), // Exibe o saldo do dia (+ ou -)
                [...(day.observacoes || []), ...(day.pontosFaltantes?.map(p => p.motivo) || [])].join("; ")
            );
          }
          sheetRows.push(row);
      });
      let sheetName = days[0].funcionarioNome.replace(/[:\/\\?*\[\]]/g, "").trim().substring(0, 30);
      if (wb.SheetNames.includes(sheetName)) sheetName = sheetName.substring(0, 27) + "1";
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(sheetRows), sheetName);
    });

    const fileName = `Relatorio_Ponto_${startDate}_a_${endDate}.xlsx`;
    window.XLSX.writeFile(wb, fileName);
  };

  const filteredFuncionarios = useMemo(() => {
    return funcionarios.filter(f => {
        const matchesSearch = f.nome.toLowerCase().includes(searchTerm.toLowerCase()) || f.pis.includes(searchTerm);
        const days = processedDays.get(f.id);
        return matchesSearch && (days ? days.some(d => d.marcacoes.length > 0) : false);
    }).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [funcionarios, searchTerm, processedDays]);

  useEffect(() => {
    if (!selectedFuncionarioId && filteredFuncionarios.length > 0) {
        setSelectedFuncionarioId(filteredFuncionarios[0].id);
    }
  }, [filteredFuncionarios, selectedFuncionarioId]);

  const currentEmployeeConfig = selectedFuncionarioId ? (employeeConfigs[selectedFuncionarioId] || config) : config;

  const handleSaveEmployeeConfig = (newConfig: ConfiguracaoSistema) => {
    if (selectedFuncionarioId) {
        setEmployeeConfigs(prev => ({
            ...prev,
            [selectedFuncionarioId]: newConfig
        }));
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      
      {/* Sidebar Navigation */}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-indigo-900 text-white transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-indigo-800 flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center">
               <Clock className="w-5 h-5 text-white" />
             </div>
             <div>
               <h1 className="font-bold text-lg tracking-tight">NexusPoint</h1>
               <p className="text-xs text-indigo-300">Gestão Inteligente</p>
             </div>
          </div>
          
          <nav className="flex-1 p-4 space-y-2">
            <div 
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-indigo-700 text-white shadow-lg shadow-indigo-900/50"
            >
              <LayoutDashboard size={20} />
              <span className="font-medium">Painel de Ponto</span>
            </div>
          </nav>

          <div className="p-4 border-t border-indigo-800">
             <div className="flex items-center gap-3 px-4 py-2 text-indigo-300 text-sm">
               <div className="w-8 h-8 rounded-full bg-indigo-800 flex items-center justify-center">
                 <User size={14} />
               </div>
               <span>Admin</span>
               <LogOut size={14} className="ml-auto cursor-pointer hover:text-white" />
             </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        
        {/* Mobile Header */}
        <div className="md:hidden bg-white border-b border-gray-200 p-4 flex items-center justify-between">
           <div className="flex items-center gap-2 font-bold text-indigo-900">
             <Clock size={20} className="text-indigo-600" /> NexusPoint
           </div>
           <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-gray-500">
             {mobileMenuOpen ? <X /> : <Menu />}
           </button>
        </div>

        {/* Dashboard View */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Dashboard Header */}
          <header className="bg-white border-b border-gray-200 px-8 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Painel de Controle</h2>
              <p className="text-sm text-slate-500">Visão geral da folha de ponto</p>
            </div>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 rounded-lg cursor-pointer hover:bg-slate-50 transition border border-slate-200 text-sm font-medium shadow-sm">
                <Upload size={16} />
                <span>Importar AFD</span>
                <input type="file" accept=".txt,.rep" onChange={handleFileUpload} className="hidden" />
              </label>
              <button 
                onClick={exportToExcel}
                disabled={processedDays.size === 0 || !startDate || !endDate || isProcessing}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-indigo-200"
              >
                {isProcessing ? <Loader size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
                <span>Exportar Relatório</span>
              </button>
            </div>
          </header>

          {/* Content Scrollable */}
          <main className="flex-1 overflow-auto p-4 md:p-8">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 h-full min-h-[600px]">
              
              {/* Left Column: Configs & Search */}
              <div className="xl:col-span-3 flex flex-col gap-6">
                {/* Period */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Calendar size={14} /> Período
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-slate-700 mb-1 block">Data Inicial</label>
                      <input type="date" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition" 
                        value={startDate} onChange={e => setStartDate(e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-700 mb-1 block">Data Final</label>
                        <input type="date" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition" 
                          value={endDate} onChange={e => setEndDate(e.target.value)} />
                    </div>
                  </div>
                </div>

                {/* Settings */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Settings size={14} /> Parâmetros
                  </h3>
                  <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-slate-700 mb-1 block">Entrada</label>
                          <input type="time" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" 
                            value={config.horarioPadraoEntrada} onChange={e => setConfig({...config, horarioPadraoEntrada: e.target.value})} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-700 mb-1 block">Saída</label>
                          <input type="time" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" 
                            value={config.horarioPadraoSaida} onChange={e => setConfig({...config, horarioPadraoSaida: e.target.value})} />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700 mb-1 block">Jornada Seg-Sex</label>
                        <input type="time" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" 
                          value={config.jornadaDiaria} onChange={e => setConfig({...config, jornadaDiaria: e.target.value})} />
                        <p className="text-[10px] text-slate-400 mt-1">* 08:48 para 44h semanais</p>
                      </div>
                      <label className="flex items-center gap-2 pt-2 cursor-pointer">
                        <input type="checkbox" checked={config.exigirAlmoco} onChange={e => setConfig({...config, exigirAlmoco: e.target.checked})} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                        <span className="text-sm text-slate-600">Validar Intervalo</span>
                      </label>
                  </div>
                </div>

                {/* Employees List */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col flex-1 overflow-hidden min-h-[300px]">
                  <div className="p-4 border-b border-slate-100">
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 text-slate-400 w-4 h-4" />
                      <input type="text" placeholder="Buscar colaborador..." 
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                          value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                      {filteredFuncionarios.length === 0 ? (
                        <div className="text-center py-8 text-slate-400 text-sm">Sem resultados</div>
                      ) : (
                        filteredFuncionarios.map(func => (
                          <button key={func.id} onClick={() => setSelectedFuncionarioId(func.id)}
                            className={`w-full text-left px-3 py-3 rounded-xl text-sm flex items-center gap-3 transition-all ${selectedFuncionarioId === func.id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${selectedFuncionarioId === func.id ? 'bg-indigo-200 text-indigo-700' : 'bg-slate-200 text-slate-500'}`}>
                              {func.nome.charAt(0)}
                            </div>
                            <div className="truncate">
                              <div className="truncate">{func.nome}</div>
                              <div className="text-[10px] opacity-70">PIS: {func.pis}</div>
                            </div>
                          </button>
                        ))
                      )}
                  </div>
                </div>
              </div>

              {/* Right Column: Detail View */}
              <div className="xl:col-span-9 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  {selectedFuncionarioId && processedDays.get(selectedFuncionarioId) ? (
                    <>
                      <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-20">
                          <div>
                            <h2 className="text-lg font-bold text-slate-800">{processedDays.get(selectedFuncionarioId)![0].funcionarioNome}</h2>
                            <div className="flex gap-2 mt-1">
                                <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded font-medium border border-slate-200">Ent: {currentEmployeeConfig.horarioPadraoEntrada}</span>
                                <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded font-medium border border-slate-200">Sai: {currentEmployeeConfig.horarioPadraoSaida}</span>
                            </div>
                          </div>
                          <button onClick={() => setShowConfigModal(true)} className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-indigo-600 transition">
                            <Settings size={18} />
                          </button>
                      </div>
                      <div className="flex-1 overflow-auto custom-scrollbar">
                          <table className="w-full text-sm text-left border-collapse">
                            <thead className="bg-slate-50 text-slate-500 font-semibold sticky top-0 z-10 shadow-sm">
                              <tr>
                                <th className="p-4 w-32 border-b border-slate-200">Data</th>
                                <th className="p-4 text-center border-b border-slate-200">E1</th>
                                <th className="p-4 text-center border-b border-slate-200">S1</th>
                                <th className="p-4 text-center border-b border-slate-200">E2</th>
                                <th className="p-4 text-center border-b border-slate-200">S2</th>
                                <th className="p-4 text-center border-b border-slate-200 w-24">Trab.</th>
                                <th className="p-4 text-center border-b border-slate-200 w-24">Saldo</th>
                                <th className="p-4 text-center border-b border-slate-200 w-16"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {processedDays.get(selectedFuncionarioId)!.map(day => {
                                const isWeekend = day.diaSemana === 'Sábado' || day.diaSemana === 'Domingo';
                                const isAtestado = day.atestado;
                                return (
                                  <tr key={day.id} className={`hover:bg-slate-50/80 group ${isWeekend ? 'bg-slate-50/30' : ''} ${isAtestado ? 'bg-green-50/30' : ''}`}>
                                      <td className="p-4">
                                        <div className="font-semibold text-slate-700">{day.data.substring(0, 5)}</div>
                                        <div className="text-[10px] uppercase text-slate-400 font-bold">{day.diaSemana?.substring(0, 3)}</div>
                                        {(day.pontosFaltantes?.length || 0) > 0 && !isAtestado && (
                                          <div className="mt-1 inline-flex items-center gap-1 text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 rounded border border-rose-100">
                                            ! {day.pontosFaltantes![0].tipo}
                                          </div>
                                        )}
                                        {isAtestado && <div className="mt-1 inline-block text-[9px] font-bold text-green-600 bg-green-50 px-1.5 rounded border border-green-100">ATESTADO</div>}
                                      </td>
                                      {[0,1,2,3].map(idx => (
                                        <td key={idx} className="p-2 text-center">
                                          <input type="text" placeholder="--" maxLength={5} disabled={!!isAtestado}
                                            value={day.marcacoes[idx]?.hora || ''}
                                            onChange={(e) => handleTimeEdit(day.id, idx, e.target.value)}
                                            className={`w-14 text-center p-1.5 rounded text-xs font-medium border transition-all outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500
                                              ${day.marcacoes[idx]?.manual ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-white border-slate-200 text-slate-600'}
                                              ${isAtestado ? 'opacity-40 cursor-not-allowed' : ''}
                                            `}
                                          />
                                        </td>
                                      ))}
                                      <td className="p-4 text-center font-bold text-slate-700">{!isAtestado ? minutesToHM(day.totalHorasTrabalhadas) : '-'}</td>
                                      <td className={`p-4 text-center text-xs font-bold ${day.saldoDia >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {!isAtestado ? minutesToHM(day.saldoDia) : '-'}
                                      </td>
                                      <td className="p-4 text-center">
                                        <button onClick={() => setAbonos(prev => ({...prev, [day.id]: !prev[day.id]}))} 
                                          className={`p-1.5 rounded hover:bg-slate-200 transition ${isAtestado ? 'text-green-600 bg-green-100 hover:bg-green-200' : 'text-slate-300'}`}>
                                          <FileText size={16} />
                                        </button>
                                      </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                      <Clock size={64} className="mb-4 text-slate-200" />
                      <p className="font-medium text-slate-500">Nenhum funcionário selecionado</p>
                      <p className="text-sm mt-2">Importe o arquivo AFD e selecione o período.</p>
                    </div>
                  )}
              </div>

            </div>
          </main>
        </div>

      </div>
      
      {/* Modal Config - Same logic, new style */}
      {showConfigModal && selectedFuncionarioId && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
               <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-slate-50">
                  <h3 className="font-bold text-slate-800">Ajuste Individual</h3>
                  <button onClick={() => setShowConfigModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
               </div>
               <div className="p-6 space-y-4">
                  <p className="text-sm text-indigo-600 bg-indigo-50 p-3 rounded-lg border border-indigo-100 font-medium">
                     {processedDays.get(selectedFuncionarioId)?.[0]?.funcionarioNome}
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Entrada</label>
                        <input id="modal-ent" type="time" defaultValue={currentEmployeeConfig.horarioPadraoEntrada} className="w-full p-2 border rounded-lg" />
                     </div>
                     <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Saída</label>
                        <input id="modal-sai" type="time" defaultValue={currentEmployeeConfig.horarioPadraoSaida} className="w-full p-2 border rounded-lg" />
                     </div>
                     <div className="col-span-2">
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Jornada</label>
                        <input id="modal-jornada" type="time" defaultValue={currentEmployeeConfig.jornadaDiaria} className="w-full p-2 border rounded-lg" />
                     </div>
                  </div>
                  <label className="flex items-center gap-2 pt-2">
                     <input id="modal-almoco" type="checkbox" defaultChecked={currentEmployeeConfig.exigirAlmoco} className="rounded text-indigo-600" />
                     <span className="text-sm text-slate-700">Validar Almoço</span>
                  </label>
               </div>
               <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                  <button onClick={() => setShowConfigModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg">Cancelar</button>
                  <button onClick={() => {
                     const ent = (document.getElementById('modal-ent') as HTMLInputElement).value;
                     const sai = (document.getElementById('modal-sai') as HTMLInputElement).value;
                     const jornada = (document.getElementById('modal-jornada') as HTMLInputElement).value;
                     const almoco = (document.getElementById('modal-almoco') as HTMLInputElement).checked;
                     handleSaveEmployeeConfig({...config, horarioPadraoEntrada: ent, horarioPadraoSaida: sai, jornadaDiaria: jornada, exigirAlmoco: almoco});
                     setShowConfigModal(false);
                  }} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm">Salvar</button>
               </div>
            </div>
         </div>
      )}

    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}