
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Role, GameStatus, Player, GameSession, SabotageState } from './types.ts';
import { COLORS, RETICLE_ICON, DOSSIER_ICON, CHRONOGRAM_TIMES } from './constants.tsx';
import HUDFrame from './components/HUDFrame.tsx';
import { generateBriefing, analyzeIntel } from './services/geminiService.ts';

const SABOTAGE_TIMER_MS = 10 * 60 * 1000; // 10 minutes réglementaires

const App: React.FC = () => {
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

  // Synchronisation temporelle (Chronogramme)
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

  // Logique de compte à rebours du sabotage
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

  const handleCreateGame = async (name: string) => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const admin: Player = { id: '1', name: name || 'ADMIN_TEST', role: Role.MJ, isNeutralised: false };
    const newSession: GameSession = {
      code,
      players: [admin],
      status: GameStatus.LOBBY,
      sabotage: { isActive: false, startTime: null, targetId: null, status: 'IDLE' },
      codisCheckUsed: false
    };
    setSession(newSession);
    setCurrentPlayer(admin);
  };

  const handleJoinGame = (name: string, code: string) => {
    const newPlayer: Player = { 
        id: Math.random().toString(), 
        name: name || 'GARDE_UNITE', 
        role: Role.GARDE, 
        isNeutralised: false 
    };
    setSession(prev => ({
      ...prev,
      code: code.toUpperCase(),
      players: [...prev.players, newPlayer]
    }));
    setCurrentPlayer(newPlayer);
  };

  const handleLaunchDemo = async () => {
    const code = "DEMO-75";
    const demoPlayers: Player[] = [
      { id: '1', name: 'Capitaine Flam', role: Role.MJ, isNeutralised: false },
      { id: '2', name: 'Sgt. Infiltré', role: Role.INFILTRÉ, isNeutralised: false },
      { id: '3', name: 'Ltn. Codis', role: Role.CODIS, isNeutralised: false },
      { id: '4', name: 'Pompier Rossi', role: Role.GARDE, isNeutralised: false },
      { id: '5', name: 'Pompier Dubois', role: Role.GARDE, isNeutralised: false },
    ];
    
    const self = demoPlayers[1];
    setSession({
      code,
      players: demoPlayers,
      status: GameStatus.ACTIVE,
      sabotage: { isActive: false, startTime: null, targetId: null, status: 'IDLE' },
      codisCheckUsed: false,
      alertMsg: "SESSION DE DÉMONSTRATION ACTIVÉE"
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

  const triggerBIP = () => {
    console.log("ALERTE BIP ACTIVÉE");
    setSession(prev => ({ ...prev, status: GameStatus.BIP_ALERTE }));
  };

  const releaseBIP = () => {
    setSession(prev => ({ ...prev, status: GameStatus.ACTIVE, alertMsg: undefined }));
  };

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

    // Simulation de transmission sécurisée
    setTimeout(() => {
      // Phase de vérification
      setSession(prev => ({ ...prev, sabotage: { ...prev.sabotage, status: 'VERIFYING' } }));
      
      setTimeout(() => {
        setShowSuccessOverlay(true);
        setTimeout(() => {
          setShowSuccessOverlay(false);
          setSession(prev => ({
            ...prev,
            sabotage: { ...prev.sabotage, status: 'COMPLETED', photoUri: capturedPhoto, isActive: false },
            alertMsg: "SABOTAGE RÉUSSI - SCELLÉ COMPROMIS"
          }));
          setCapturedPhoto(null);
        }, 4000);
      }, 2000);
    }, 2500);
  };

  const reportSabotage = () => {
    if (session.sabotage.isActive) {
      setSession(prev => ({
        ...prev,
        sabotage: { ...prev.sabotage, isActive: false, status: 'DEJOUÉ' }
      }));
      setSession(prev => ({ ...prev, alertMsg: "SABOTAGE DÉJOUÉ PAR LA GARDE !" }));
      setTimeout(() => setSession(prev => ({ ...prev, alertMsg: undefined })), 5000);
    }
  };

  const checkDossier = async (targetId: string) => {
    if (session.codisCheckUsed || currentPlayer?.role !== Role.CODIS) return;
    const target = session.players.find(p => p.id === targetId);
    if (!target) return;

    const intel = await analyzeIntel(currentPlayer.name, target.name);
    setIntelReport(`OBJET : ${target.name}\n\n${intel}\n\nCAMP PROBABLE : ${target.role === Role.INFILTRÉ ? 'MENACE' : 'ALLIÉ'}`);
    setSession(prev => ({ ...prev, codisCheckUsed: true }));
  };

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
              <input id="name-input" className="w-full bg-slate-900 border border-slate-700 p-3 text-neon placeholder:opacity-30 outline-none" placeholder="IDENTIFIANT POMPIER" />
              <input id="code-input" className="w-full bg-slate-900 border border-slate-700 p-3 text-neon placeholder:opacity-30 outline-none" placeholder="CODE SESSION (SI JOIN)" />
              <div className="grid grid-cols-2 gap-4 pt-4">
                <button onClick={() => handleCreateGame((document.getElementById('name-input') as HTMLInputElement).value)} className="border border-[#F0FF00] p-3 text-xs font-bold hover:bg-[#F0FF00] hover:text-[#0A192F] transition-colors">CRÉER MJ</button>
                <button onClick={() => handleJoinGame((document.getElementById('name-input') as HTMLInputElement).value, (document.getElementById('code-input') as HTMLInputElement).value)} className="border border-slate-500 p-3 text-xs font-bold hover:bg-slate-500 hover:text-white transition-colors">REJOINDRE</button>
              </div>
              <button onClick={handleLaunchDemo} className="w-full border border-blue-500/50 text-blue-400 p-3 text-[10px] font-bold uppercase tracking-widest hover:bg-blue-500/10 transition-colors">--- LANCER MODE DÉMO ---</button>
            </div>
          </HUDFrame>
        ) : (
          <HUDFrame title="Salle d'Attente">
            <div className="space-y-4 py-4 text-center">
              <p className="text-2xl font-bold tracking-widest">{session.code}</p>
              <div className="text-xs text-slate-400">EN ATTENTE DE LA GARDE ({session.players.length} CONNECTÉS)</div>
              <ul className="space-y-1 text-sm max-h-40 overflow-y-auto">
                {session.players.map(p => (
                  <li key={p.id} className="flex justify-between border-b border-slate-800 py-1">
                    <span>{p.name}</span>
                    <span className="text-[10px] opacity-40 uppercase">{p.role === Role.MJ ? 'ADMIN' : 'PRÊT'}</span>
                  </li>
                ))}
              </ul>
              {currentPlayer.role === Role.MJ && session.players.length >= 3 && (
                <button onClick={handleStartGame} className="w-full mt-4 bg-[#F0FF00] text-[#0A192F] p-4 font-bold tracking-widest text-sm">LANCER L'ALERTE</button>
              )}
            </div>
          </HUDFrame>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full app-container relative">
      {/* SABOTAGE RÉUSSI OVERLAY */}
      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center p-8 text-center border-[12px] border-green-500 animate-neon-green">
          <div className="relative mb-12">
            <div className="absolute -inset-8 border border-green-400/30 rounded-full animate-ping"></div>
            <div className="text-green-500 scale-[3]">
                {RETICLE_ICON}
            </div>
          </div>
          <h2 className="text-5xl font-black text-green-400 italic mb-6 glow-green tracking-tighter uppercase">SABOTAGE RÉUSSI</h2>
          <div className="bg-green-500/20 px-6 py-2 border border-green-500/50">
             <p className="text-sm text-green-200 font-bold uppercase tracking-[0.3em]">Scellé Neutralisé</p>
          </div>
          <p className="mt-8 text-[10px] text-green-500/60 uppercase tracking-widest font-mono">Transmission terminée. Identité protégée.</p>
        </div>
      )}

      {/* BIP OVERLAY */}
      {session.status === GameStatus.BIP_ALERTE && (
        <div className="fixed inset-0 z-[100] bg-red-950/90 flex flex-col items-center justify-center p-8 text-center border-4 border-red-600 animate-pulse">
          <div className="w-24 h-24 border-4 border-red-600 rounded-full flex items-center justify-center mb-6">
              <div className="w-16 h-16 bg-red-600 rounded-full animate-ping"></div>
          </div>
          <h2 className="text-4xl font-black text-white italic mb-4 glow-red">URGENCE : ALERTE BIP</h2>
          <p className="text-sm text-red-100 opacity-80 uppercase tracking-widest">Toutes les opérations sont suspendues.</p>
          {currentPlayer?.role === Role.MJ && (
            <button onClick={releaseBIP} className="mt-12 border-2 border-white text-white px-8 py-3 font-bold hover:bg-white hover:text-red-900 transition-all">REPRENDRE LA GARDE</button>
          )}
        </div>
      )}

      <header className="h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/50">
        <div className="flex flex-col"><span className="text-[10px] opacity-40 leading-none">AGENT</span><span className="text-xs font-bold">{currentPlayer?.name}</span></div>
        <div className="flex flex-col items-center"><span className="text-[10px] opacity-40 leading-none">PHASE</span><span className="text-xs font-bold text-[#F0FF00]">{session.status === GameStatus.BIP_ALERTE ? 'NEUTRALISÉE' : 'OPÉRATIONNELLE'}</span></div>
        <div className="flex flex-col items-end"><span className="text-[10px] opacity-40 leading-none">CODE</span><span className="text-xs font-bold">{session.code}</span></div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {session.alertMsg && (
          <div className="bg-red-900/20 border-l-4 border-red-600 p-3 flex items-center space-x-3">
             <div className="animate-pulse w-2 h-2 bg-red-600 rounded-full"></div>
             <p className="text-[10px] font-bold uppercase tracking-widest text-red-400">{session.alertMsg}</p>
          </div>
        )}

        <HUDFrame title="Dossier Personnel" variant={currentPlayer?.role === Role.INFILTRÉ ? 'alert' : 'neon'}>
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-[10px] opacity-40 uppercase">Rôle Assigné :</p>
              <h3 className={`text-2xl font-bold italic tracking-tighter ${currentPlayer?.role === Role.INFILTRÉ ? 'text-red-500' : 'text-[#F0FF00]'}`}>{currentPlayer?.role}</h3>
            </div>
            <div className="h-10 w-10 border border-slate-700 flex items-center justify-center">{RETICLE_ICON}</div>
          </div>
          <div className="bg-slate-900/80 p-3 border-l-2 border-[#F0FF00] min-h-[60px]">
             <p className="text-[11px] leading-relaxed italic opacity-80 whitespace-pre-wrap">{briefing || "Chargement du briefing tactique..."}</p>
          </div>
        </HUDFrame>

        {currentPlayer?.role === Role.INFILTRÉ && !session.sabotage.isActive && session.sabotage.status !== 'COMPLETED' && session.sabotage.status !== 'TRANSMITTING' && session.sabotage.status !== 'VERIFYING' && (
          <HUDFrame title="Action Offensive" variant="alert">
            <button onClick={launchSabotage} className="w-full bg-red-600 text-white p-4 font-bold flex items-center justify-center space-x-2"><span>LANCER SABOTAGE</span></button>
            <p className="text-[9px] mt-2 opacity-50 uppercase text-center">Règle de latence : 10 minutes avant validation.</p>
          </HUDFrame>
        )}

        {currentPlayer?.role === Role.INFILTRÉ && session.sabotage.status === 'TRANSMITTING' && (
          <HUDFrame title="Uplink Sécurisé" variant="alert">
             <div className="flex flex-col items-center justify-center py-8 space-y-6">
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-red-900">
                  <div className="h-full bg-red-600 animate-progress"></div>
                </div>
                <div className="text-center">
                  <p className="text-red-500 font-bold animate-pulse text-xs tracking-widest uppercase">Transmission des données scellées...</p>
                  <p className="text-[8px] opacity-40 mt-1">CRYPTAGE DES DONNÉES EN COURS</p>
                </div>
             </div>
          </HUDFrame>
        )}

        {currentPlayer?.role === Role.INFILTRÉ && session.sabotage.status === 'VERIFYING' && (
          <HUDFrame title="Confirmation Tactique" variant="neon">
             <div className="flex flex-col items-center justify-center py-6 space-y-4">
                <div className="w-12 h-12 border-2 border-green-500 rounded-full flex items-center justify-center animate-pulse">
                  <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 p-4 font-mono text-[10px] w-full text-green-400 space-y-1">
                  <p className="animate-pulse">> UPLINK: STABLE</p>
                  <p className="animate-pulse delay-75">> CHECKSUM: VALIDÉ</p>
                  <p className="animate-pulse delay-150">> SCELLÉ: NEUTRALISÉ</p>
                  <p className="animate-pulse delay-300 font-bold text-green-300">> MISSION: ACCEPTÉE</p>
                </div>
                <p className="text-green-500 font-bold text-xs animate-pulse tracking-widest uppercase">Signature validée. Neutralisation confirmée.</p>
             </div>
          </HUDFrame>
        )}

        {currentPlayer?.role === Role.INFILTRÉ && session.sabotage.status === 'COMPLETED' && (
          <HUDFrame title="Opération Réussie" variant="neon">
             <div className="space-y-4">
                <div className="aspect-square bg-slate-900 border border-neon relative overflow-hidden">
                  <img src={session.sabotage.photoUri} className="w-full h-full object-cover opacity-50" alt="Scellé" />
                  <div className="absolute inset-0 flex items-center justify-center"><span className="text-neon text-xl font-bold italic tracking-widest glow-neon">NEUTRALISÉ</span></div>
                </div>
                <p className="text-[10px] text-center opacity-50 uppercase">Données scellées transmises au réseau.</p>
             </div>
          </HUDFrame>
        )}

        {currentPlayer?.role === Role.INFILTRÉ && session.sabotage.status === 'PENDING' && (
           <HUDFrame title="Latence Opérationnelle" variant="alert">
              <div className="py-4 text-center">
                <div className={`text-5xl font-black mb-2 font-mono ${sabotageTimeLeft < 60000 ? 'text-red-600 animate-pulse glow-red' : 'text-red-500'}`}>{formatTime(sabotageTimeLeft)}</div>
                <div className="text-[10px] opacity-50 uppercase tracking-[0.2em] font-bold">SABOTAGE EN COURS...</div>
              </div>
           </HUDFrame>
        )}

        {currentPlayer?.role === Role.INFILTRÉ && session.sabotage.status === 'READY_FOR_UPLOAD' && (
          <HUDFrame title="Validation Scellé" variant="alert">
             <div className="space-y-4">
                <p className="text-xs text-red-400 uppercase font-bold text-center animate-pulse tracking-widest">SABOTAGE PRÊT - UPLOADEZ LE SCELLÉ</p>
                {capturedPhoto ? (
                  <div className="relative aspect-square border-2 border-neon bg-black">
                    <img src={capturedPhoto} className="w-full h-full object-cover" alt="Capture" />
                    <button onClick={() => setCapturedPhoto(null)} className="absolute top-2 right-2 bg-red-600 text-white p-1 text-[8px] font-bold">ANNULER</button>
                  </div>
                ) : (
                  <div className="h-56 bg-slate-900/60 border-2 border-dashed border-red-600 flex flex-col items-center justify-center relative group active:bg-red-950/20 transition-colors">
                    <div className="absolute inset-0 bg-red-500/5 opacity-0 group-hover:opacity-100 pointer-events-none"></div>
                    
                    {/* Visual target decoration */}
                    <div className="relative mb-4">
                       {RETICLE_ICON}
                       <div className="absolute -inset-2 border border-red-500/30 rounded-full animate-ping"></div>
                    </div>

                    <div className="bg-red-600 text-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest flex items-center space-x-2 shadow-lg shadow-red-900/50">
                       <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                       <span>DÉCLENCHER CAPTURE</span>
                    </div>

                    <div className="mt-4 flex items-center space-x-2">
                       <span className="text-[9px] uppercase opacity-40 font-bold text-red-400">Accès Caméra Requis</span>
                       <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>
                    </div>

                    <p className="mt-2 text-[8px] text-red-500/60 uppercase max-w-[80%] text-center italic">Appuyez n'importe où dans cette zone pour ouvrir l'objectif</p>
                    
                    {/* The actual hidden input spanning the whole box */}
                    <input 
                      type="file" 
                      accept="image/*" 
                      capture="environment" 
                      onChange={handlePhotoCapture} 
                      className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" 
                    />
                  </div>
                )}
                <button onClick={completeSabotage} disabled={!capturedPhoto} className={`w-full p-4 font-bold transition-all text-sm uppercase tracking-tighter ${capturedPhoto ? 'bg-red-600 text-white shadow-[0_0_15px_rgba(255,0,0,0.4)]' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}>TRANSMETTRE AU RÉSEAU</button>
             </div>
          </HUDFrame>
        )}

        {currentPlayer?.role !== Role.INFILTRÉ && currentPlayer?.role !== Role.MJ && (
          <HUDFrame title="Vigilance">
            <button onClick={reportSabotage} className="w-full border border-red-500 text-red-500 p-4 font-bold hover:bg-red-500 hover:text-white transition-all flex items-center justify-center space-x-2"><span>SIGNALER SABOTAGE</span></button>
          </HUDFrame>
        )}

        {currentPlayer?.role === Role.CODIS && (
          <HUDFrame title="Renseignement CODIS">
            {!session.codisCheckUsed ? (
              <div className="space-y-3">
                <select id="codis-target" className="w-full bg-slate-900 border border-slate-700 p-2 text-xs text-neon outline-none">
                  <option value="">SÉLECTIONNER UNE CIBLE</option>
                  {session.players.filter(p => p.id !== currentPlayer.id && p.role !== Role.MJ).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button onClick={() => checkDossier((document.getElementById('codis-target') as HTMLSelectElement).value)} className="w-full bg-blue-600 text-white p-3 font-bold text-xs">CHECK DOSSIER (1/SESSION)</button>
              </div>
            ) : (
              <div className="bg-blue-900/20 p-3 border-l-2 border-blue-500"><p className="text-[11px] font-mono whitespace-pre-wrap">{intelReport || "Analyse en cours..."}</p></div>
            )}
          </HUDFrame>
        )}

        <HUDFrame title="Vote de Mise à Pied">
          <div className="grid grid-cols-1 gap-2">
            {session.players.filter(p => p.id !== currentPlayer?.id && p.role !== Role.MJ).map(p => (
              <button key={p.id} onClick={() => setVoteSelection(p.id)} className={`p-2 text-left text-xs border ${voteSelection === p.id ? 'bg-[#F0FF00] text-[#0A192F] border-[#F0FF00]' : 'border-slate-800 text-slate-400'}`}>{p.name}</button>
            ))}
          </div>
          <button className="w-full mt-4 bg-slate-800 text-slate-500 p-2 text-[10px] font-bold uppercase tracking-widest cursor-not-allowed">VOTE ANONYME (ATTENTE MJ)</button>
        </HUDFrame>
      </main>

      <footer className="p-4 bg-slate-900/90 border-t border-slate-800">
        <button onClick={triggerBIP} className="w-full h-16 bg-red-600 rounded-lg shadow-[0_0_20px_rgba(255,0,0,0.5)] flex flex-col items-center justify-center border-b-4 border-red-800 active:translate-y-1 active:border-b-0">
          <span className="text-xl font-black text-white glow-red">ALERTE BIP</span>
          <span className="text-[8px] text-red-200 uppercase tracking-[0.4em] font-bold">Neutralisation Immédiate</span>
        </button>
      </footer>
    </div>
  );
};

export default App;
