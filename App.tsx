
import React, { useState, useEffect } from 'react';
import { Role, GameStatus, Player, GameSession } from './types.ts';
import { RETICLE_ICON, CHRONOGRAM_TIMES } from './constants.tsx';
import HUDFrame from './components/HUDFrame.tsx';
import { generateBriefing, analyzeIntel } from './services/geminiService.ts';

const SABOTAGE_TIMER_MS = 10 * 60 * 1000;

const App: React.FC = () => {
  // States pour les inputs du Lobby
  const [inputName, setInputName] = useState('');
  const [inputCode, setInputCode] = useState('');

  const [session, setSession] = useState<GameSession>({
    code: '',
    players: [],
    status: GameStatus.LOBBY,
    sabotage: { isActive: false, startTime: null, targetId: null, status: 'IDLE' },
    codisCheckUsed: false
  });
  
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [briefing, setBriefing] = useState<string>('');
  const [intelReport, setIntelReport] = useState<string | null>(null);
  const [voteSelection, setVoteSelection] = useState<string | null>(null);
  const [lastNotificationTime, setLastNotificationTime] = useState<string | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [sabotageTimeLeft, setSabotageTimeLeft] = useState<number>(SABOTAGE_TIMER_MS);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);

  useEffect(() => {
    const checkTime = () => {
      const now = new Date();
      const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      if (CHRONOGRAM_TIMES.includes(timeStr) && timeStr !== lastNotificationTime) {
        setLastNotificationTime(timeStr);
        setSession(prev => ({ ...prev, alertMsg: `SYNCHRONISATION OPÉRATIONNELLE : ${timeStr}` }));
      }
    };
    const timer = setInterval(checkTime, 1000);
    return () => clearInterval(timer);
  }, [lastNotificationTime]);

  useEffect(() => {
    if (session.sabotage.isActive && session.sabotage.startTime && session.sabotage.status === 'PENDING') {
      const timer = setInterval(() => {
        const elapsed = Date.now() - (session.sabotage.startTime || 0);
        const remaining = Math.max(0, SABOTAGE_TIMER_MS - elapsed);
        setSabotageTimeLeft(remaining);

        if (remaining <= 0) {
          setSession(prev => ({
            ...prev,
            sabotage: { ...prev.sabotage, status: 'READY_FOR_UPLOAD' }
          }));
          clearInterval(timer);
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [session.sabotage.isActive, session.sabotage.startTime, session.sabotage.status]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCreateGame = () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const admin: Player = { id: '1', name: inputName || 'ADMIN_TEST', role: Role.MJ, isNeutralised: false };
    setSession({
      code,
      players: [admin],
      status: GameStatus.LOBBY,
      sabotage: { isActive: false, startTime: null, targetId: null, status: 'IDLE' },
      codisCheckUsed: false
    });
    setCurrentPlayer(admin);
  };

  const handleJoinGame = () => {
    const newPlayer: Player = { 
        id: Math.random().toString(), 
        name: inputName || 'GARDE_UNITE', 
        role: Role.GARDE, 
        isNeutralised: false 
    };
    setSession(prev => ({
      ...prev,
      code: inputCode.toUpperCase() || 'SESSION',
      players: [...prev.players, newPlayer]
    }));
    setCurrentPlayer(newPlayer);
  };

  const handleLaunchDemo = async () => {
    const demoPlayers: Player[] = [
      { id: '1', name: 'Capitaine Flam', role: Role.MJ, isNeutralised: false },
      { id: '2', name: 'Sgt. Infiltré', role: Role.INFILTRÉ, isNeutralised: false },
      { id: '3', name: 'Ltn. Codis', role: Role.CODIS, isNeutralised: false },
      { id: '4', name: 'Pompier Rossi', role: Role.GARDE, isNeutralised: false },
    ];
    const self = demoPlayers[1];
    setSession({
      code: 'DEMO-75',
      players: demoPlayers,
      status: GameStatus.ACTIVE,
      sabotage: { isActive: false, startTime: null, targetId: null, status: 'IDLE' },
      codisCheckUsed: false,
      alertMsg: "MODE DÉMO ACTIVÉ"
    });
    setCurrentPlayer(self);
    const b = await generateBriefing(self.role, self.name);
    setBriefing(b);
  };

  const handleStartGame = async () => {
    const players = [...session.players];
    const rolesPool = [Role.INFILTRÉ, Role.CODIS];
    while (rolesPool.length < players.length - 1) rolesPool.push(Role.GARDE);
    
    const nonAdmin = players.filter(p => p.role !== Role.MJ);
    nonAdmin.forEach(p => {
      const idx = Math.floor(Math.random() * rolesPool.length);
      p.role = rolesPool.splice(idx, 1)[0];
    });

    setSession(prev => ({ ...prev, players, status: GameStatus.ACTIVE }));
    if (currentPlayer) {
      const b = await generateBriefing(currentPlayer.role, currentPlayer.name);
      setBriefing(b);
    }
  };

  const triggerBIP = () => setSession(prev => ({ ...prev, status: GameStatus.BIP_ALERTE }));
  const releaseBIP = () => setSession(prev => ({ ...prev, status: GameStatus.ACTIVE, alertMsg: undefined }));

  const launchSabotage = () => {
    setSabotageTimeLeft(SABOTAGE_TIMER_MS);
    setSession(prev => ({
      ...prev,
      sabotage: { isActive: true, startTime: Date.now(), targetId: null, status: 'PENDING' }
    }));
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setCapturedPhoto(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const completeSabotage = () => {
    if (!capturedPhoto) return;
    setSession(prev => ({ ...prev, sabotage: { ...prev.sabotage, status: 'TRANSMITTING' } }));
    setTimeout(() => {
      setSession(prev => ({ ...prev, sabotage: { ...prev.sabotage, status: 'VERIFYING' } }));
      setTimeout(() => {
        setShowSuccessOverlay(true);
        setTimeout(() => {
          setShowSuccessOverlay(false);
          setSession(prev => ({
            ...prev,
            sabotage: { ...prev.sabotage, status: 'COMPLETED', photoUri: capturedPhoto, isActive: false },
            alertMsg: "SABOTAGE RÉUSSI"
          }));
          setCapturedPhoto(null);
        }, 3000);
      }, 1500);
    }, 2000);
  };

  const reportSabotage = () => {
    if (session.sabotage.isActive) {
      setSession(prev => ({
        ...prev,
        sabotage: { ...prev.sabotage, isActive: false, status: 'DEJOUÉ' },
        alertMsg: "SABOTAGE DÉJOUÉ !"
      }));
      setTimeout(() => setSession(prev => ({ ...prev, alertMsg: undefined })), 4000);
    }
  };

  const checkDossier = async (targetId: string) => {
    if (session.codisCheckUsed || !targetId || currentPlayer?.role !== Role.CODIS) return;
    const target = session.players.find(p => p.id === targetId);
    if (!target) return;
    setSession(prev => ({ ...prev, codisCheckUsed: true }));
    const intel = await analyzeIntel(currentPlayer.name, target.name);
    setIntelReport(`OBJET : ${target.name}\n\n${intel}\n\nCAMP : ${target.role === Role.INFILTRÉ ? 'MENACE' : 'ALLIÉ'}`);
  };

  // Rendu du Lobby
  if (session.status === GameStatus.LOBBY) {
    return (
      <div className="flex flex-col h-full p-6 space-y-8 app-container justify-center">
        <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tighter italic glow-neon mb-2">OPÉRATION SCELLÉ</h1>
            <p className="text-xs opacity-50 uppercase tracking-[0.3em]">Tactical Guard Game</p>
        </div>
        {!currentPlayer ? (
          <HUDFrame title="Connexion Réseau">
            <div className="space-y-4 py-4">
              <input 
                value={inputName} 
                onChange={e => setInputName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 p-3 text-[#F0FF00] placeholder:opacity-30 outline-none" 
                placeholder="IDENTIFIANT POMPIER" 
              />
              <input 
                value={inputCode} 
                onChange={e => setInputCode(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 p-3 text-[#F0FF00] placeholder:opacity-30 outline-none" 
                placeholder="CODE SESSION (SI JOIN)" 
              />
              <div className="grid grid-cols-2 gap-4 pt-4">
                <button onClick={handleCreateGame} className="border border-[#F0FF00] p-3 text-xs font-bold hover:bg-[#F0FF00] hover:text-[#0A192F] transition-colors">CRÉER MJ</button>
                <button onClick={handleJoinGame} className="border border-slate-500 p-3 text-xs font-bold hover:bg-slate-500 hover:text-white transition-colors">REJOINDRE</button>
              </div>
              <button onClick={handleLaunchDemo} className="w-full border border-blue-500/50 text-blue-400 p-3 text-[10px] font-bold uppercase tracking-widest hover:bg-blue-500/10 transition-colors">LANCER MODE DÉMO</button>
            </div>
          </HUDFrame>
        ) : (
          <HUDFrame title="Salle d'Attente">
            <div className="space-y-4 py-4 text-center">
              <p className="text-2xl font-bold tracking-widest">{session.code}</p>
              <div className="text-xs text-slate-400">EN ATTENTE ({session.players.length} CONNECTÉS)</div>
              <ul className="space-y-1 text-sm max-h-40 overflow-y-auto">
                {session.players.map(p => (
                  <li key={p.id} className="flex justify-between border-b border-slate-800 py-1">
                    <span>{p.name}</span>
                    <span className="text-[10px] opacity-40 uppercase">{p.role === Role.MJ ? 'ADMIN' : 'PRÊT'}</span>
                  </li>
                ))}
              </ul>
              {currentPlayer.role === Role.MJ && (
                <button onClick={handleStartGame} className="w-full mt-4 bg-[#F0FF00] text-[#0A192F] p-4 font-bold tracking-widest text-sm">LANCER LA GARDE</button>
              )}
            </div>
          </HUDFrame>
        )}
      </div>
    );
  }

  // Rendu du Jeu Actif
  return (
    <div className="flex flex-col h-full app-container relative">
      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center p-8 text-center border-[12px] border-green-500 animate-neon-green">
          <h2 className="text-5xl font-black text-green-400 italic mb-6 glow-green uppercase">SABOTAGE RÉUSSI</h2>
          <p className="text-sm text-green-200 font-bold uppercase tracking-[0.3em]">Scellé Neutralisé</p>
        </div>
      )}

      {session.status === GameStatus.BIP_ALERTE && (
        <div className="fixed inset-0 z-[100] bg-red-950/90 flex flex-col items-center justify-center p-8 text-center border-4 border-red-600 animate-pulse">
          <h2 className="text-4xl font-black text-white italic mb-4 glow-red uppercase">URGENCE : ALERTE BIP</h2>
          {currentPlayer?.role === Role.MJ && <button onClick={releaseBIP} className="mt-12 border-2 border-white text-white px-8 py-3 font-bold">REPRENDRE</button>}
        </div>
      )}

      <header className="h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/50">
        <div className="flex flex-col"><span className="text-[10px] opacity-40">AGENT</span><span className="text-xs font-bold">{currentPlayer?.name}</span></div>
        <div className="flex flex-col items-center"><span className="text-[10px] opacity-40">CODE</span><span className="text-xs font-bold">{session.code}</span></div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {session.alertMsg && (
          <div className="bg-red-900/20 border-l-4 border-red-600 p-3 text-[10px] font-bold uppercase text-red-400">{session.alertMsg}</div>
        )}

        <HUDFrame title="Dossier" variant={currentPlayer?.role === Role.INFILTRÉ ? 'alert' : 'neon'}>
          <h3 className={`text-2xl font-bold italic ${currentPlayer?.role === Role.INFILTRÉ ? 'text-red-500' : 'text-[#F0FF00]'}`}>{currentPlayer?.role}</h3>
          <p className="text-[11px] mt-2 italic opacity-80 whitespace-pre-wrap">{briefing || "Chargement..."}</p>
        </HUDFrame>

        {currentPlayer?.role === Role.INFILTRÉ && session.sabotage.status === 'IDLE' && (
          <button onClick={launchSabotage} className="w-full bg-red-600 text-white p-4 font-bold">LANCER SABOTAGE</button>
        )}

        {currentPlayer?.role === Role.INFILTRÉ && session.sabotage.status === 'PENDING' && (
           <HUDFrame title="Sabotage en cours" variant="alert">
              <div className="text-5xl font-black text-center text-red-500 font-mono">{formatTime(sabotageTimeLeft)}</div>
           </HUDFrame>
        )}

        {currentPlayer?.role === Role.INFILTRÉ && session.sabotage.status === 'READY_FOR_UPLOAD' && (
          <HUDFrame title="Upload Scellé" variant="alert">
            <input type="file" accept="image/*" capture="environment" onChange={handlePhotoCapture} className="w-full text-xs mb-4" />
            <button onClick={completeSabotage} disabled={!capturedPhoto} className="w-full bg-red-600 text-white p-4 font-bold disabled:opacity-30">TRANSMETTRE</button>
          </HUDFrame>
        )}

        {currentPlayer?.role !== Role.INFILTRÉ && currentPlayer?.role !== Role.MJ && session.sabotage.isActive && (
          <button onClick={reportSabotage} className="w-full border border-red-500 text-red-500 p-4 font-bold">SIGNALER SABOTAGE</button>
        )}

        {currentPlayer?.role === Role.CODIS && (
          <HUDFrame title="CODIS">
            {!session.codisCheckUsed ? (
              <div className="space-y-2">
                <select id="codis-sel" className="w-full bg-slate-900 border border-slate-700 p-2 text-xs text-[#F0FF00]">
                  <option value="">CIBLE</option>
                  {session.players.filter(p => p.id !== currentPlayer.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button onClick={() => checkDossier((document.getElementById('codis-sel') as HTMLSelectElement).value)} className="w-full bg-blue-600 text-white p-2 text-xs font-bold">CHECK</button>
              </div>
            ) : (
              <div className="text-[10px] font-mono text-blue-400">{intelReport}</div>
            )}
          </HUDFrame>
        )}
      </main>

      <footer className="p-4 bg-slate-900/90 border-t border-slate-800">
        <button onClick={triggerBIP} className="w-full h-16 bg-red-600 rounded-lg text-white font-black text-xl shadow-[0_0_15px_rgba(255,0,0,0.5)]">ALERTE BIP</button>
      </footer>
    </div>
  );
};

export default App;
