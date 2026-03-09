import React, { useState, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area
} from 'recharts';
import { 
  Upload, FileText, BarChart3, PieChart as PieChartIcon, 
  TrendingUp, Users, AlertCircle, CheckCircle2, Sparkles, ChevronRight,
  LayoutDashboard, Settings, HelpCircle, LogOut
} from 'lucide-react';
import Papa from 'papaparse';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { SprintData } from './types';
import { analyzeSprintData, AnalysisFile } from './services/geminiService';
import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist';

// Set PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const COLORS = ['#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#1D4ED8'];

export default function App() {
  const [data, setData] = useState<SprintData[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [complementaryInfo, setComplementaryInfo] = useState("");
  const [complementaryFiles, setComplementaryFiles] = useState<{ name: string, data: string, mimeType: string }[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'roles' | 'ai'>('overview');
  const [parseError, setParseError] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        const parsedData = results.data as any[];
        const fields = results.meta.fields || [];
        
        if (parsedData.length === 0) {
          setParseError("The file appears to be empty.");
          return;
        }

        // Identify columns
        const nombreField = fields.find(f => 
          ['nombre', 'member', 'miembro', 'asignee', 'assignee'].includes(f.toLowerCase().trim())
        );
        const rolField = fields.find(f => f.toLowerCase().trim() === 'rol' || f.toLowerCase().trim() === 'role');
        const grandTotalField = fields.find(f => f.toLowerCase().trim() === 'grand total' || f.toLowerCase().trim() === 'total' || f.toLowerCase().trim() === 'total general');
        
        if (!nombreField || !rolField) {
          setParseError("Could not find required columns: 'nombre' and 'rol'.");
          return;
        }

        // Sprint columns are those that are not nombre, rol, or grand total
        const sprintFields = fields.filter(f => 
          f !== nombreField && 
          f !== rolField && 
          f !== grandTotalField
        );

        if (sprintFields.length === 0) {
          setParseError("No sprint columns found. Please include at least one sprint column.");
          return;
        }

        // Calculate total points per sprint
        const sprintTotals: Record<string, number> = {};
        sprintFields.forEach(sprintName => {
          sprintTotals[sprintName] = parsedData.reduce((sum, row) => sum + Number(row[sprintName] || 0), 0);
        });

        const flattenedData: SprintData[] = [];

        parsedData.forEach(row => {
          const member = String(row[nombreField] || "");
          const role = String(row[rolField] || "");
          
          if (!member || !role) return;

          sprintFields.forEach(sprintName => {
            const points = Number(row[sprintName] || 0);
            if (points === 0) return; // Skip zero points

            const sprintTotal = sprintTotals[sprintName] || 0;

            flattenedData.push({
              member,
              role,
              sprint: sprintName,
              storyPoints: points,
              contributionPercentage: sprintTotal > 0 ? Math.round((points / sprintTotal) * 100) : 0
            });
          });
        });

        if (flattenedData.length === 0) {
          setParseError("No valid sprint data found in the rows.");
          setData([]);
        } else {
          setData(flattenedData);
          setAnalysis(null);
        }
      },
      error: (error) => {
        setParseError(`Error parsing CSV: ${error.message}`);
      }
    });
  };

  const handleComplementaryFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: { name: string, data: string, mimeType: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();

      if (file.type === 'application/pdf') {
        // For PDF, we'll send it as base64 to Gemini
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.readAsDataURL(file);
        });
        newFiles.push({ name: file.name, data: base64, mimeType: file.type });
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // For DOCX, we extract text using mammoth
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        // We'll append this text to the complementaryInfo state
        setComplementaryInfo(prev => prev + `\n\n[Content from ${file.name}]:\n${result.value}`);
        newFiles.push({ name: file.name, data: '', mimeType: 'text/plain' }); // Mark as processed
      }
    }

    setComplementaryFiles(prev => [...prev, ...newFiles]);
  };

  const removeComplementaryFile = (index: number) => {
    setComplementaryFiles(prev => prev.filter((_, i) => i !== index));
  };

  const runAnalysis = async () => {
    if (data.length === 0) return;
    setIsAnalyzing(true);
    try {
      const filesToUpload = complementaryFiles
        .filter(f => f.data !== '') // Only send actual file data (PDFs)
        .map(f => ({ data: f.data, mimeType: f.mimeType }));
      
      const result = await analyzeSprintData(data, complementaryInfo, filesToUpload);
      setAnalysis(result);
      setActiveTab('ai');
    } catch (error) {
      console.error("Analysis failed:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Data transformations
  const pointsBySprint = useMemo(() => {
    const grouped = data.reduce((acc, curr) => {
      acc[curr.sprint] = (acc[curr.sprint] || 0) + curr.storyPoints;
      return acc;
    }, {} as Record<string, number>);
    
    return Object.entries(grouped)
      .map(([name, points]) => ({ name, points }))
      .sort((a, b) => {
        // Extract numbers from sprint names (e.g., "Sprint 1" -> 1)
        const numA = parseInt(a.name.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.name.replace(/\D/g, '')) || 0;
        
        // If both have numbers, sort by number
        if (numA !== numB) return numA - numB;
        
        // Fallback to alphabetical sort
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [data]);

  const pointsByMember = useMemo(() => {
    const grouped = data.reduce((acc, curr) => {
      acc[curr.member] = (acc[curr.member] || 0) + curr.storyPoints;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [data]);

  const pointsByRole = useMemo(() => {
    const grouped = data.reduce((acc, curr) => {
      acc[curr.role] = (acc[curr.role] || 0) + curr.storyPoints;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [data]);

  const totalPoints = data.reduce((sum, item) => sum + item.storyPoints, 0);
  const avgPointsPerSprint = pointsBySprint.length > 0 ? totalPoints / pointsBySprint.length : 0;
  const uniqueMembers = new Set(data.map(d => d.member)).size;

  return (
    <div className="min-h-screen bg-atmospheric text-[#0F172A] font-sans selection:bg-[#2563EB] selection:text-white">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 border-r border-[#E2E8F0] bg-white z-20 hidden md:flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        <div className="p-8 border-b border-[#E2E8F0]">
          <h1 className="font-serif italic font-bold text-2xl tracking-tight text-[#2563EB]">SprintInsight</h1>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#94A3B8] mt-1 font-bold">Performance Analytics</p>
        </div>
        
        <nav className="flex-1 px-4 py-8 space-y-2">
          <NavItem 
            icon={<LayoutDashboard size={18} />} 
            label="Dashboard" 
            active={activeTab !== 'ai'} 
            onClick={() => setActiveTab('overview')} 
          />
          <NavItem 
            icon={<Sparkles size={18} />} 
            label="AI Insights" 
            active={activeTab === 'ai'} 
            onClick={() => setActiveTab('ai')} 
          />
          <NavItem icon={<Users size={18} />} label="Team" />
          <NavItem icon={<Settings size={18} />} label="Settings" />
        </nav>

        <div className="p-8 border-t border-[#E5E7EB]">
          <div className="flex items-center gap-3 text-[#64748B] hover:text-[#2563EB] cursor-pointer transition-colors">
            <LogOut size={18} />
            <span className="text-sm font-medium">Logout</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="md:ml-64 p-8 min-h-screen">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
          <div>
            <h2 className="font-serif italic font-bold text-5xl md:text-6xl tracking-tight text-[#0F172A]">Sprint Analysis</h2>
            <p className="text-sm text-[#64748B] mt-3 max-w-md leading-relaxed">
              Upload your sprint data to visualize team velocity, role distribution, and get AI-powered recommendations.
            </p>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-4">
              <div className="relative group">
                <div className="absolute -inset-2 border-2 border-dashed border-[#2563EB]/40 rounded-lg pointer-events-none"></div>
                <label className="relative flex items-center gap-2 px-6 py-3 bg-[#2563EB] text-white rounded-none cursor-pointer overflow-hidden transition-all hover:bg-[#1D4ED8] shadow-lg shadow-blue-500/20">
                  <Upload size={18} />
                  <span className="text-sm font-bold uppercase tracking-wider">Upload CSV</span>
                  <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                </label>
                <p className="absolute -bottom-6 left-0 w-full text-center text-[10px] text-[#2563EB] font-medium whitespace-nowrap">
                  the first column in csv should be Asignee
                </p>
              </div>
              
              {data.length > 0 && (
                <button 
                  onClick={runAnalysis}
                  disabled={isAnalyzing}
                  className="flex items-center gap-2 px-6 py-3 border border-[#0F172A] bg-white text-[#0F172A] text-sm font-bold uppercase tracking-wider hover:bg-[#0F172A] hover:text-white transition-colors disabled:opacity-50"
                >
                  {isAnalyzing ? "Analyzing..." : "Generate AI Insights"}
                </button>
              )}
            </div>
            {parseError && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 text-red-600 text-[10px] font-bold uppercase tracking-wider"
              >
                <AlertCircle size={14} />
                {parseError}
              </motion.div>
            )}
          </div>
        </header>

        {data.length === 0 ? (
          <div className="h-[60vh] flex flex-col items-center justify-center border border-[#E2E8F0] rounded-2xl bg-white shadow-sm overflow-hidden relative">
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#2563EB 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
            <div className="w-20 h-20 bg-[#2563EB]/5 rounded-full flex items-center justify-center mb-8 relative">
              <FileText size={36} className="text-[#2563EB]" />
              <motion.div 
                animate={{ scale: [1, 1.2, 1] }} 
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute inset-0 rounded-full border border-[#2563EB]/20"
              />
            </div>
            <h3 className="text-3xl font-serif italic font-bold text-[#0F172A]">No data uploaded yet</h3>
            <p className="text-sm text-[#64748B] mt-3 max-w-xs text-center leading-relaxed">Upload a CSV file with columns: <span className="text-[#2563EB] font-medium">Asignee, rol, sprints,</span> and <span className="text-[#2563EB] font-medium">Grand Total</span></p>
            
            <div className="mt-10 p-6 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs font-mono max-w-md w-full mx-auto">
              <p className="text-[#94A3B8] mb-3 uppercase tracking-[0.15em] font-bold">Expected CSV Structure:</p>
              <div className="space-y-1 text-[#475569]">
                <p className="border-b border-[#E2E8F0] pb-1 mb-1"><span className="text-[#2563EB]">Asignee,rol,Sprint 1,Sprint 2,Sprint 3,Grand Total</span></p>
                <p>Alice,Dev,8,12,10,30</p>
                <p>Bob,Dev,12,8,15,35</p>
                <p>Charlie,QA,5,7,6,18</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-12">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard label="Total Story Points" value={totalPoints} icon={<TrendingUp size={20} />} />
              <StatCard label="Avg Points / Sprint" value={avgPointsPerSprint.toFixed(1)} icon={<BarChart3 size={20} />} />
              <StatCard label="Team Members" value={uniqueMembers} icon={<Users size={20} />} />
              <StatCard label="Sprints Analyzed" value={pointsBySprint.length} icon={<LayoutDashboard size={20} />} />
            </div>

            {/* Tabs */}
            <div className="border-b border-[#E2E8F0] flex gap-8">
              <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>Overview</TabButton>
              <TabButton active={activeTab === 'members'} onClick={() => setActiveTab('members')}>Members</TabButton>
              <TabButton active={activeTab === 'roles'} onClick={() => setActiveTab('roles')}>Roles</TabButton>
              <TabButton active={activeTab === 'ai'} onClick={() => setActiveTab('ai')}>AI Analysis</TabButton>
            </div>

            {/* Content Area */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'overview' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <ChartContainer title="Velocity Over Sprints" subtitle="Story points accumulated per sprint">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={pointsBySprint}>
                          <defs>
                            <linearGradient id="colorPoints" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#2563EB" stopOpacity={0.1}/>
                              <stop offset="95%" stopColor="#2563EB" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                          <XAxis 
                            dataKey="name" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fontSize: 10, fill: '#64748B' }} 
                            tickFormatter={(value) => value.replace(/\D/g, '')}
                            interval={0}
                          />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748B' }} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#0F172A', border: 'none', borderRadius: '4px', color: 'white' }}
                            itemStyle={{ color: 'white' }}
                          />
                          <Area type="monotone" dataKey="points" stroke="#2563EB" strokeWidth={2} fillOpacity={1} fill="url(#colorPoints)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartContainer>

                    <ChartContainer title="Points by Role" subtitle="Distribution of work across different roles">
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={pointsByRole}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {pointsByRole.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend verticalAlign="bottom" height={36} />
                        </PieChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </div>
                )}

                {activeTab === 'members' && (
                  <div className="space-y-8">
                    <ChartContainer title="Individual Contribution" subtitle="Total story points by team member">
                      <ResponsiveContainer width="100%" height={400}>
                        <BarChart data={pointsByMember} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                          <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748B' }} />
                          <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748B' }} width={100} />
                          <Tooltip 
                            cursor={{ fill: '#F1F5F9' }}
                            contentStyle={{ backgroundColor: '#0F172A', border: 'none', borderRadius: '4px', color: 'white' }}
                          />
                          <Bar dataKey="value" fill="#2563EB" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>

                    <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden shadow-sm">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#0F172A] text-white text-[10px] uppercase tracking-widest">
                            <th className="p-4 font-medium">Member</th>
                            <th className="p-4 font-medium">Role</th>
                            <th className="p-4 font-medium">Sprint</th>
                            <th className="p-4 font-medium">Points</th>
                            <th className="p-4 font-medium">Contribution</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm">
                          {data.map((row, i) => (
                            <tr key={i} className="border-b border-[#E2E8F0] hover:bg-[#F8FAFC] transition-colors">
                              <td className="p-4 font-medium">{row.member}</td>
                              <td className="p-4 text-[#64748B]">{row.role}</td>
                              <td className="p-4 text-[#64748B]">{row.sprint}</td>
                              <td className="p-4 font-mono">{row.storyPoints}</td>
                              <td className="p-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-16 h-1.5 bg-[#E2E8F0] rounded-full overflow-hidden">
                                    <div className="h-full bg-[#2563EB]" style={{ width: `${row.contributionPercentage}%` }} />
                                  </div>
                                  <span className="text-[10px] font-mono">{row.contributionPercentage}%</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'roles' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <ChartContainer title="Role Performance" subtitle="Total points delivered by role">
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={pointsByRole}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748B' }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748B' }} />
                          <Tooltip 
                            cursor={{ fill: '#F1F5F9' }}
                            contentStyle={{ backgroundColor: '#0F172A', border: 'none', borderRadius: '4px', color: 'white' }}
                          />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {pointsByRole.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                    
                    <div className="flex flex-col justify-center gap-6">
                      {pointsByRole.map((role, i) => (
                        <div key={i} className="p-6 bg-white border border-[#E2E8F0] rounded-xl flex items-center justify-between shadow-sm">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.15em] text-[#94A3B8] font-bold">{role.name}</p>
                            <h4 className="text-2xl font-serif italic text-[#2563EB]">{role.value} Points</h4>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] uppercase tracking-[0.15em] text-[#94A3B8] font-bold">Share</p>
                            <h4 className="text-xl font-mono">{((role.value / totalPoints) * 100).toFixed(1)}%</h4>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'ai' && (
                  <div className="max-w-4xl mx-auto space-y-8">
                    <div className="bg-white p-8 border border-[#E2E8F0] rounded-2xl shadow-sm">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="w-8 h-8 bg-[#F1F5F9] rounded-full flex items-center justify-center">
                          <AlertCircle size={16} className="text-[#64748B]" />
                        </div>
                        <h4 className="text-sm font-bold uppercase tracking-wider text-[#0F172A]">Complementary Context</h4>
                      </div>
                      <p className="text-xs text-[#64748B] mb-4">
                        Add extra context about the project, team dynamics, or specific obstacles encountered during these sprints. This information will help the AI provide more accurate and relevant insights.
                      </p>
                      <textarea
                        value={complementaryInfo}
                        onChange={(e) => setComplementaryInfo(e.target.value)}
                        placeholder="Example: During Sprint 3, two developers were on leave. We also faced a major bug in the authentication module that delayed several tasks..."
                        className="w-full h-32 p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] transition-all resize-none"
                      />

                      <div className="mt-6">
                        <label className="flex items-center gap-2 px-4 py-2 border border-[#E2E8F0] bg-white text-[#64748B] rounded-lg cursor-pointer hover:bg-[#F8FAFC] transition-all w-fit">
                          <Upload size={16} />
                          <span className="text-xs font-bold uppercase tracking-wider">Upload PDF / DOCX</span>
                          <input type="file" accept=".pdf,.docx" multiple onChange={handleComplementaryFileUpload} className="hidden" />
                        </label>
                        
                        {complementaryFiles.length > 0 && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {complementaryFiles.map((file, i) => (
                              <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-[#F1F5F9] border border-[#E2E8F0] rounded-full text-[10px] font-bold text-[#475569]">
                                <FileText size={12} />
                                <span>{file.name}</span>
                                <button onClick={() => removeComplementaryFile(i)} className="hover:text-red-500 transition-colors">
                                  <AlertCircle size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {!analysis ? (
                      <div className="p-12 text-center border border-[#E2E8F0] rounded-2xl bg-white shadow-sm">
                        <Sparkles size={48} className="mx-auto mb-6 text-[#2563EB] opacity-20" />
                        <h3 className="text-2xl font-serif italic font-bold">AI Analysis Ready</h3>
                        <p className="text-sm text-[#64748B] mt-2 mb-8">Click the button above to generate deep insights and recommendations based on your team's data.</p>
                        <button 
                          onClick={runAnalysis}
                          disabled={isAnalyzing}
                          className="px-8 py-4 bg-[#2563EB] text-white text-sm font-bold uppercase tracking-widest hover:bg-[#1D4ED8] transition-all disabled:opacity-50 shadow-lg shadow-blue-500/20"
                        >
                          {isAnalyzing ? "Analyzing Team Performance..." : "Generate Analysis Now"}
                        </button>
                      </div>
                    ) : (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="prose prose-slate max-w-none bg-white p-12 border border-[#E2E8F0] rounded-2xl shadow-sm"
                      >
                        <div className="flex items-center gap-3 mb-8 pb-8 border-b border-[#E2E8F0]">
                          <div className="w-10 h-10 bg-[#2563EB] rounded-full flex items-center justify-center">
                            <Sparkles size={20} className="text-white" />
                          </div>
                          <div>
                            <h3 className="text-xl font-serif italic m-0 text-[#0F172A]">AI Performance Insights</h3>
                            <p className="text-[10px] uppercase tracking-[0.2em] text-[#94A3B8]">Generated by Gemini 3.1 Pro</p>
                          </div>
                        </div>
                        <div className="markdown-body">
                          <ReactMarkdown>{analysis}</ReactMarkdown>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="md:ml-64 p-8 border-t border-[#E2E8F0] text-center">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#94A3B8]">
          SprintInsight Analyzer &copy; 2024 &bull; Built for Performance Teams
        </p>
      </footer>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-all rounded-none",
        active 
          ? "bg-[#2563EB] text-white shadow-lg shadow-blue-500/20" 
          : "text-[#64748B] hover:text-[#2563EB] hover:bg-[#2563EB]/5"
      )}
    >
      {icon}
      <span>{label}</span>
      {active && <motion.div layoutId="nav-active" className="ml-auto w-1 h-4 bg-white" />}
    </button>
  );
}

function StatCard({ label, value, icon }: { label: string, value: string | number, icon: React.ReactNode }) {
  return (
    <div className="p-6 bg-white border border-[#E2E8F0] rounded-xl hover:border-[#2563EB] transition-all group shadow-sm relative overflow-hidden">
      <div className="absolute top-0 right-0 w-16 h-16 bg-[#2563EB]/[0.02] rounded-bl-full pointer-events-none"></div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] uppercase tracking-[0.15em] text-[#94A3B8] font-bold">{label}</span>
        <div className="text-[#E2E8F0] group-hover:text-[#2563EB] transition-colors">{icon}</div>
      </div>
      <div className="text-4xl font-serif italic font-bold text-[#0F172A]">{value}</div>
    </div>
  );
}

function TabButton({ children, active, onClick }: { children: React.ReactNode, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "pb-4 text-[10px] uppercase tracking-[0.15em] font-bold transition-all relative",
        active ? "text-[#2563EB]" : "text-[#94A3B8] hover:text-[#475569]"
      )}
    >
      {children}
      {active && (
        <motion.div 
          layoutId="tab-underline" 
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2563EB]" 
        />
      )}
    </button>
  );
}

function ChartContainer({ title, subtitle, children }: { title: string, subtitle: string, children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-8 shadow-sm relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-[#2563EB]/10"></div>
      <div className="mb-10">
        <h3 className="text-2xl font-serif italic font-bold text-[#0F172A]">{title}</h3>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#94A3B8] mt-1 font-bold">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
