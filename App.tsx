
import React, { useState, useEffect, useRef } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { Role, GameStatus, Player, GameSession } from './types.ts';
import { RETICLE_ICON, CHRONOGRAM_TIMES } from './constants.tsx';
import HUDFrame from './components/HUDFrame.tsx';
import { generateBriefing, analyzeIntel } from './services/geminiService.ts';

const SABOTAGE_TIMER_MS = 10 * 60 * 1000;

const App: React.FC = () => {
  const [inputName, setInputName] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'>('DISCONNECTED');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<{ [id: string]: DataConnection }>({});
  
  // État de la session avec Ref pour accès synchrone dans les callbacks
  const [session, setSession] = useState<GameSession>({
    code: '',
    players: [],
    status: GameStatus.LOBBY,
    sabotage: { isActive: false, startTime: null, targetId: null, status: 'IDLE' },
    codisCheckUsed: false
  });
  const sessionRef = useRef<GameSession>(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [briefing, setBriefing] = useState<string>('');
  const [intelReport, setIntelReport] = useState<string | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [sabotageTimeLeft, setSabotageTimeLeft] = useState<number>(SABOTAGE_TIMER_MS);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);

  // Fonction de diffusion (Host uniquement)
  const broadcastSession = (newSession: GameSession) => {
    setSession(newSession);
    const conns = Object.values(connectionsRef.current) as DataConnection[];
    conns.forEach(conn => {
      if (conn && conn.open) {
        conn.send({ type: 'SYNC_SESSION', payload: newSession });
      }
    });
  };

  // Logique de traitement des actions (Host uniquement)
  // Utilisation d'une ref pour que les callbacks PeerJS appellent toujours la version la plus récente
  const handleClientAction = (senderId: string, action: { type: string, payload: any }) => {
    const current = sessionRef.current;
    console.log(`[MJ] Traitement Action: ${action.type} de ${senderId}`);

    switch (action.type) {
      case 'JOIN':
        const newPlayer = action.payload as Player;
        const exists = current.players.find(p => p.id === newPlayer.id);
        if (!exists) {
          console.log(`[MJ] + AGENT DÉTECTÉ : ${newPlayer.name} (${newPlayer.id})`);
          const updatedPlayers = [...current.players, newPlayer];
          broadcastSession({ ...current, players: updatedPlayers });
        } else {
          console.log(`[MJ] Agent déjà connu : ${newPlayer.name}`);
          broadcastSession({ ...current });
        }
        break;
      case 'SABOTAGE_START':
        broadcastSession({
          ...current,
          sabotage: { isActive: true, startTime: Date.now(), targetId: null, status: 'PENDING' },
          alertMsg: "INTRUSION DÉTECTÉE - SCAN EN COURS"
        });
        break;
      case 'SABOTAGE_REPORT':
        broadcastSession({
          ...current,
          sabotage: { ...current.sabotage, isActive: false, status: 'DEJOUÉ' },
          alertMsg: "SABOTAGE DÉJOUÉ PAR LA GARDE !"
        });
        setTimeout(() => {
            broadcastSession({ ...sessionRef.current, alertMsg: undefined });
        }, 4000);
        break;
      case 'SABOTAGE_COMPLETE':
        broadcastSession({
          ...current,
          sabotage: { ...current.sabotage, status: 'COMPLETED', photoUri: action.payload, isActive: false },
          alertMsg: "SCELLÉ COMPROMIS - ZONE ROUGE"
        });
        break;
      case 'BIP_TRIGGER':
        broadcastSession({ ...current, status: GameStatus.BIP_ALERTE });
        break;
      case 'BIP_RELEASE':
        broadcastSession({ ...current, status: GameStatus.ACTIVE, alertMsg: undefined });
        break;
      case 'CODIS_USE':
        broadcastSession({ ...current, codisCheckUsed: true });
        break;
    }
  };

  const actionRef = useRef(handleClientAction);
  useEffect(() => { actionRef.current = handleClientAction; });

  const sendToHost = (type: string, payload: any) => {
    if (isHost) {
      actionRef.current(currentPlayer?.id || 'mj', { type, payload });
      return;
    }
    const hostConn = (Object.values(connectionsRef.current) as DataConnection[])[0];
    if (hostConn && hostConn.open) {
      hostConn.send({ type, payload, senderId: currentPlayer?.id });
    }
  };

  const handleCreateGame = () => {
    setErrorMessage(null);
    setIsHost(true);
    setConnectionStatus('CONNECTING');
    
    const adminId = 'mj-' + Math.random().toString(36).substr(2, 4);
    const admin: Player = { id: adminId, name: inputName || 'CENTRAL_MJ', role: Role.MJ, isNeutralised: false };
    setCurrentPlayer(admin);
    
    const initialSession: GameSession = {
      code: '',
      players: [admin],
      status: GameStatus.LOBBY,
      sabotage: { isActive: false, startTime: null, targetId: null, status: 'IDLE' },
      codisCheckUsed: false
    };
    setSession(initialSession);

    const p = new Peer();
    peerRef.current = p;

    p.on('open', (id) => {
      setPeerId(id);
      setConnectionStatus('CONNECTED');
      setSession(prev => ({ ...prev, code: id }));
      console.log("[MJ] SERVEUR ACTIF - ID:", id);
    });

    p.on('connection', (conn) => {
      console.log(`[MJ] Connexion entrante : ${conn.peer}`);
      connectionsRef.current[conn.peer] = conn;

      conn.on('open', () => {
        console.log(`[MJ] Canal ouvert avec ${conn.peer}. Envoi configuration...`);
        conn.send({ type: 'HANDSHAKE_OK', payload: sessionRef.current });
      });

      conn.on('data', (data: any) => {
        if (data && data.type) {
          actionRef.current(data.senderId || conn.peer, data);
        }
      });

      conn.on('close', () => {
        delete connectionsRef.current[conn.peer];
      });
    });

    p.on('error', (err) => {
      setErrorMessage(`Erreur Terminal : ${err.type}`);
      setConnectionStatus('DISCONNECTED');
    });
  };

  const handleJoinGame = () => {
    const cleanCode = inputCode.trim();
    if (!cleanCode) {
      setErrorMessage("Code MJ requis");
      return;
    }
    setErrorMessage(null);
    setIsHost(false);
    setConnectionStatus('CONNECTING');

    const playerId = 'unit-' + Math.random().toString(36).substr(2, 4);
    const player: Player = { id: playerId, name: inputName || 'UNITÉ', role: Role.GARDE, isNeutralised: false };
    setCurrentPlayer(player);
    
    const p = new Peer();
    peerRef.current = p;

    p.on('open', (myId) => {
      setPeerId(myId);
      const conn = p.connect(cleanCode, { reliable: true });
      
      const timeout = setTimeout(() => {
        if (connectionStatus !== 'CONNECTED') {
          setErrorMessage("Échec liaison MJ.");
          setConnectionStatus('DISCONNECTED');
          p.destroy();
        }
      }, 8000);

      conn.on('open', () => {
        clearTimeout(timeout);
        connectionsRef.current[cleanCode] = conn;
        setConnectionStatus('CONNECTED');
        // Identification immédiate
        conn.send({ type: 'JOIN', payload: player, senderId: playerId });
      });

      conn.on('data', (data: any) => {
        if (data.type === 'HANDSHAKE_OK' || data.type === 'SYNC_SESSION') {
          if (data.payload) setSession(data.payload);
          if (data.type === 'HANDSHAKE_OK') {
             conn.send({ type: 'JOIN', payload: player, senderId: playerId });
          }
        }
      });

      conn.on('close', () => {
        setConnectionStatus('DISCONNECTED');
        setErrorMessage("Liaison Central coupée.");
      });
    });

    p.on('error', (err) => {
      setErrorMessage(`Erreur liaison : ${err.type}`);
      setConnectionStatus('DISCONNECTED');
    });
  };

  useEffect(() => {
    if (currentPlayer && session.status === GameStatus.ACTIVE && !briefing) {
      const p = session.players.find(pl => pl.id === currentPlayer.id);
      if (p) generateBriefing(p.role, p.name).then(setBriefing);
    }
  }, [session.status, currentPlayer]);

  useEffect(() => {
    if (session.sabotage.isActive && session.sabotage.startTime && session.sabotage.status === 'PENDING') {
      const timer = setInterval(() => {
        const elapsed = Date.now() - (session.sabotage.startTime || 0);
        const remaining = Math.max(0, SABOTAGE_TIMER_MS - elapsed);
        setSabotageTimeLeft(remaining);
        if (remaining <= 0 && isHost) {
          broadcastSession({ ...sessionRef.current, sabotage: { ...sessionRef.current.sabotage, status: 'READY_FOR_UPLOAD' } });
          clearInterval(timer);
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [session.sabotage.isActive, session.sabotage.startTime, session.sabotage.status, isHost]);

  const handleStartGame = () => {
    if (!isHost) return;
    const players = [...session.players];
    const nonAdmin = players.filter(p => p.role !== Role.MJ);
    if (nonAdmin.length < 1) {
        setErrorMessage("Effectif insuffisant.");
        return;
    }
    const rolesPool = [Role.INFILTRÉ, Role.CODIS];
    while (rolesPool.length < nonAdmin.length) rolesPool.push(Role.GARDE);
    nonAdmin.forEach(p => {
      const idx = Math.floor(Math.random() * rolesPool.length);
      p.role = rolesPool.splice(idx, 1)[0];
    });
    broadcastSession({ ...session, players, status: GameStatus.ACTIVE });
  };

  if (session.status === GameStatus.LOBBY) {
    return (
      <div className="flex flex-col h-full p-6 space-y-8 app-container justify-center">
        <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tighter italic glow-neon mb-2 uppercase font-['Orbitron']">Opération Scellé</h1>
            <p className="text-[10px] opacity-60 uppercase tracking-[0.5em] font-black text-[#F0FF00]">Réseau Tactique Sapeurs-Pompiers</p>
        </div>
        
        {errorMessage && (
          <div className="bg-red-950/80 border-l-4 border-red-500 p-4 text-[10px] text-red-200 font-bold uppercase animate-pulse">
            <span className="text-red-500 mr-2">[!]</span> {errorMessage}
          </div>
        )}

        {connectionStatus !== 'CONNECTED' && !isHost ? (
          <HUDFrame title="Initialisation Unité">
            <div className="space-y-4 py-4">
              <input 
                value={inputName} onChange={e => setInputName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 p-4 text-[#F0FF00] placeholder:opacity-20 outline-none text-sm font-mono tracking-widest focus:border-[#F0FF00]" 
                placeholder="ID AGENT" 
              />
              <div className="grid grid-cols-2 gap-4 pt-2">
                <button 
                    disabled={connectionStatus === 'CONNECTING'}
                    onClick={handleCreateGame} 
                    className="border-2 border-[#F0FF00] p-4 text-xs font-black uppercase tracking-widest hover:bg-[#F0FF00] hover:text-[#0A192F] transition-all disabled:opacity-30"
                >
                    POSTE CENTRAL
                </button>
                <div className="flex flex-col space-y-2">
                   <input 
                    value={inputCode} 
                    onChange={e => setInputCode(e.target.value)}
                    className="bg-slate-900 border border-slate-700 p-2 text-[#F0FF00] placeholder:opacity-20 outline-none text-[10px] font-mono focus:border-[#F0FF00]" 
                    placeholder="CODE MJ" 
                   />
                   <button 
                    disabled={connectionStatus === 'CONNECTING'}
                    onClick={handleJoinGame} 
                    className="border-2 border-slate-500 p-2 text-[10px] font-black uppercase tracking-widest hover:bg-slate-500 hover:text-white transition-all disabled:opacity-30"
                   >
                    {connectionStatus === 'CONNECTING' ? 'LIAISON...' : 'REJOINDRE'}
                   </button>
                </div>
              </div>
            </div>
          </HUDFrame>
        ) : (
          <HUDFrame title={isHost ? "Terminal Central (MJ)" : "Unité de Garde"}>
            <div className="space-y-4 py-4 text-center">
              <div className="bg-slate-900/90 p-5 border border-slate-700 shadow-2xl relative overflow-hidden">
                <p className="text-[10px] opacity-40 uppercase mb-2 font-black tracking-widest">Fréquence Opérationnelle</p>
                <p className="text-2xl font-mono font-black tracking-[0.2em] text-[#F0FF00] select-all break-all">
                    {session.code || peerId || "SYNC..."}
                </p>
              </div>
              
              <div className="flex justify-between items-center px-1">
                 <span className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Agents : {session.players.length}</span>
                 <div className="flex space-x-1">
                    {[...Array(session.players.length)].map((_,i) => <div key={i} className="w-2 h-3 bg-[#F0FF00] animate-pulse"></div>)}
                 </div>
              </div>

              <ul className="space-y-1 text-[11px] max-h-56 overflow-y-auto text-left font-mono border-t border-slate-800 pt-3">
                {session.players.map(p => (
                  <li key={p.id} className="flex justify-between items-center border-b border-slate-900/50 py-3 px-2">
                    <span className={p.id === currentPlayer?.id ? "text-[#F0FF00] font-black" : "text-slate-400"}>
                        {p.id === currentPlayer?.id ? ">> " : "   "}{p.name}
                    </span>
                    <span className={`text-[8px] px-2 py-0.5 border rounded-sm uppercase font-black ${p.role === Role.MJ ? 'border-red-500 text-red-500' : 'border-slate-700 text-slate-500'}`}>
                        {p.role === Role.MJ ? 'MJ' : 'UNITÉ'}
                    </span>
                  </li>
                ))}
              </ul>

              {isHost ? (
                <button 
                    onClick={handleStartGame} 
                    disabled={session.players.length < 2} 
                    className="w-full mt-6 bg-[#F0FF00] text-[#0A192F] p-5 font-black tracking-[0.3em] text-sm uppercase disabled:opacity-20 shadow-[0_0_40px_rgba(240,255,0,0.2)] active:scale-95 transition-transform"
                >
                    DÉPLOYER LA GARDE
                </button>
              ) : (
                <div className="py-8 flex flex-col items-center">
                    <div className="w-10 h-10 border-4 border-[#F0FF00] border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-[10px] uppercase tracking-[0.4em] text-blue-400 font-black animate-pulse">Liaison établie. En attente...</p>
                </div>
              )}
            </div>
          </HUDFrame>
        )}
      </div>
    );
  }

  const roleColor = currentPlayer?.role === Role.INFILTRÉ ? 'text-red-500' : 'text-[#F0FF00]';

  return (
    <div className="flex flex-col h-full app-container relative">
      <header className="h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/98 backdrop-blur-lg sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className={`w-2.5 h-2.5 rounded-full ${connectionStatus === 'CONNECTED' ? 'bg-green-500 animate-pulse shadow-[0_0_12px_#22c55e]' : 'bg-red-500'}`}></div>
          <div className="flex flex-col"><span className="text-[8px] opacity-40 font-bold uppercase tracking-widest">Agent</span><span className="text-[10px] font-black">{currentPlayer?.name}</span></div>
        </div>
        <div className="flex flex-col items-center"><span className="text-[8px] opacity-40 font-bold uppercase tracking-widest">Secteur</span><span className="text-[10px] font-black text-[#F0FF00] font-mono">{session.code?.substring(0,8) || "---"}</span></div>
        <div className="flex flex-col items-end"><span className="text-[8px] opacity-40 font-bold uppercase tracking-widest">Statut</span><span className="text-[10px] font-black uppercase text-blue-400">{session.status}</span></div>
      </header>

      {session.status === GameStatus.BIP_ALERTE && (
        <div className="fixed inset-0 z-[100] bg-red-950/98 flex flex-col items-center justify-center p-8 text-center border-[10px] border-red-600 animate-pulse">
          <div className="scale-[2] mb-12">{RETICLE_ICON}</div>
          <h2 className="text-6xl font-black text-white italic mb-6 glow-red uppercase tracking-tighter">ALERTE BIP</h2>
          <p className="text-sm text-red-200 tracking-[0.5em] uppercase mb-16 font-black">Interruption Opérationnelle Immédiate</p>
          {isHost && (
            <button onClick={() => sendToHost('BIP_RELEASE', null)} className="border-4 border-white text-white px-14 py-7 font-black text-xl hover:bg-white hover:text-red-900 transition-all uppercase tracking-[0.3em] active:scale-90">
                REPRENDRE
            </button>
          )}
        </div>
      )}

      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[200] bg-black/98 flex flex-col items-center justify-center text-center p-8 border-[15px] border-green-500 animate-neon-green">
           <h2 className="text-7xl font-black text-green-400 italic mb-6 glow-green uppercase font-['Orbitron']">SABOTAGE RÉUSSI</h2>
           <p className="text-2xl font-black tracking-[0.6em] text-green-100 uppercase">Scellé compromis</p>
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-4 space-y-6 pb-44">
        {session.alertMsg && (
          <div className="bg-red-950/50 border border-red-600 p-5 text-[10px] font-black uppercase text-red-500 animate-pulse flex items-center space-x-4 shadow-[0_0_20px_rgba(255,0,0,0.2)]">
            <div className="w-5 h-5 bg-red-600 rounded-full animate-ping flex-shrink-0"></div>
            <span className="leading-relaxed tracking-widest">{session.alertMsg}</span>
          </div>
        )}

        <HUDFrame title="Données de Mission" variant={currentPlayer?.role === Role.INFILTRÉ ? 'alert' : 'neon'}>
          <div className="flex justify-between items-center mb-4">
            <h3 className={`text-4xl font-black italic tracking-tighter uppercase ${roleColor}`}>{currentPlayer?.role}</h3>
            <div className="animate-spin duration-[25000ms] opacity-50">{RETICLE_ICON}</div>
          </div>
          <div className="bg-slate-900/70 p-6 border-l-4 border-[#F0FF00] min-h-[100px] shadow-inner relative overflow-hidden">
             <p className="text-[13px] font-mono leading-relaxed text-slate-100 italic whitespace-pre-wrap">{briefing || "Décryptage du dossier en cours... Liaison CODIS active."}</p>
          </div>
        </HUDFrame>

        {currentPlayer?.role === Role.INFILTRÉ && (
          <div className="space-y-5">
            {session.sabotage.status === 'IDLE' && (
               <button onClick={() => sendToHost('SABOTAGE_START', null)} className="w-full bg-red-600 text-white p-8 font-black uppercase tracking-[0.5em] text-sm shadow-[0_15px_40px_rgba(255,0,0,0.5)] border-b-8 border-red-900 active:translate-y-1 transition-all">LANCER SABOTAGE</button>
            )}
            {session.sabotage.status === 'PENDING' && (
               <HUDFrame title="Latence de Sécurité" variant="alert">
                  <div className="text-8xl font-black text-center text-red-500 font-mono py-10 tracking-[0.2em] glow-red animate-pulse">
                    {Math.floor(sabotageTimeLeft/1000/60)}:{Math.floor((sabotageTimeLeft/1000)%60).toString().padStart(2,'0')}
                  </div>
                  <p className="text-[10px] text-center opacity-70 uppercase font-black tracking-[0.4em]">Progression furtive vers le scellé...</p>
               </HUDFrame>
            )}
            {session.sabotage.status === 'READY_FOR_UPLOAD' && (
              <HUDFrame title="Preuve de Neutralisation" variant="alert">
                <div className="space-y-5">
                  {!capturedPhoto ? (
                    <div className="h-72 bg-slate-900/60 border-4 border-dashed border-red-600 flex flex-col items-center justify-center relative hover:bg-red-900/20 transition-colors">
                      <input type="file" accept="image/*" capture="environment" onChange={(e) => {
                         const file = e.target.files?.[0];
                         if (file) {
                           const r = new FileReader();
                           r.onloadend = () => setCapturedPhoto(r.result as string);
                           r.readAsDataURL(file);
                         }
                      }} className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" />
                      <div className="text-center p-6">
                        <div className="text-red-600 mb-6 flex justify-center scale-[2.5]">{RETICLE_ICON}</div>
                        <p className="text-[13px] font-black text-red-400 uppercase tracking-[0.3em]">Scanner l'objet compromis</p>
                      </div>
                    </div>
                  ) : (
                    <div className="relative aspect-square border-4 border-green-500 bg-black overflow-hidden shadow-2xl">
                       <img src={capturedPhoto} className="w-full h-full object-contain" alt="Scan" />
                       <button onClick={() => setCapturedPhoto(null)} className="absolute top-5 right-5 bg-red-600 px-5 py-2 text-[11px] font-black uppercase border-b-4 border-red-900">RE-SCANNER</button>
                    </div>
                  )}
                  <button onClick={() => {
                     setShowSuccessOverlay(true);
                     setTimeout(() => setShowSuccessOverlay(false), 3000);
                     sendToHost('SABOTAGE_COMPLETE', capturedPhoto);
                     setCapturedPhoto(null);
                  }} disabled={!capturedPhoto} className="w-full bg-red-600 text-white p-7 font-black uppercase tracking-[0.3em] text-sm disabled:opacity-30 border-b-8 border-red-900 shadow-xl">TRANSMETTRE AU CENTRAL</button>
                </div>
              </HUDFrame>
            )}
          </div>
        )}

        {currentPlayer?.role !== Role.MJ && currentPlayer?.role !== Role.INFILTRÉ && (
           <HUDFrame title="Module de Garde" variant={session.sabotage.isActive ? 'alert' : 'muted'}>
              <button 
                onClick={() => sendToHost('SABOTAGE_REPORT', null)} 
                disabled={!session.sabotage.isActive}
                className={`w-full p-8 font-black uppercase tracking-[0.4em] text-[11px] border-4 transition-all ${session.sabotage.isActive ? 'border-red-600 text-red-500 animate-pulse bg-red-950/40 shadow-[0_0_30px_rgba(255,0,0,0.3)]' : 'border-slate-800 text-slate-700 opacity-60'}`}
              >
                {session.sabotage.isActive ? "ANOMALIE DÉTECTÉE ! SIGNALER" : "ZÉRO ACTIVITÉ SUSPECTE"}
              </button>
           </HUDFrame>
        )}

        {currentPlayer?.role === Role.CODIS && (
           <HUDFrame title="Terminal Renseignement">
             {!session.codisCheckUsed ? (
               <div className="space-y-5">
                 <select id="codis-sel" className="w-full bg-slate-900 border-2 border-slate-700 p-5 text-[14px] text-[#F0FF00] font-mono outline-none appearance-none focus:border-[#F0FF00] shadow-inner">
                    <option value="">-- CIBLE À ANALYSER --</option>
                    {session.players.filter(p => p.id !== currentPlayer.id && p.role !== Role.MJ).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                 </select>
                 <button onClick={async () => {
                   const tid = (document.getElementById('codis-sel') as HTMLSelectElement).value;
                   if(!tid) return;
                   const target = session.players.find(p => p.id === tid);
                   if(!target) return;
                   const report = await analyzeIntel(currentPlayer.name, target.name);
                   setIntelReport(`OBJET : ${target.name}\nRÉSULTAT : ${report}\nCONCLUSION : ${target.role === Role.INFILTRÉ ? 'HOSTILE' : 'ALLIÉ'}`);
                   if (isHost) broadcastSession({ ...session, codisCheckUsed: true });
                   else sendToHost('CODIS_USE', null);
                 }} className="w-full bg-blue-700 text-white p-6 font-black text-xs tracking-[0.3em] uppercase border-b-8 border-blue-900 active:translate-y-1 transition-all shadow-lg">ANALYSE BIOMÉTRIQUE CODIS</button>
               </div>
             ) : (
               <div className="bg-blue-900/40 p-6 border-l-4 border-blue-500 font-mono text-[12px] text-blue-100 leading-relaxed italic shadow-inner">
                 {intelReport || "SESSIONS ÉPUISÉES. TERMINAL VERROUILLÉ."}
               </div>
             )}
           </HUDFrame>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 p-5 bg-[#0A192F]/98 backdrop-blur-3xl border-t-2 border-slate-800 z-[90] shadow-[0_-15px_50px_rgba(0,0,0,0.6)]">
        <button 
          onClick={() => sendToHost(session.status === GameStatus.BIP_ALERTE ? 'BIP_RELEASE' : 'BIP_TRIGGER', null)}
          className="w-full h-28 bg-red-600 rounded-2xl flex flex-col items-center justify-center shadow-[0_-10px_50px_rgba(255,0,0,0.6)] active:scale-95 transition-all border-b-[12px] border-red-900 active:border-b-0 hover:brightness-110"
        >
          <span className="text-4xl font-black text-white glow-red italic tracking-tighter uppercase mb-1 font-['Orbitron']">ALERTE BIP</span>
          <span className="text-[11px] text-red-100 font-black uppercase tracking-[0.6em] opacity-90 animate-pulse">Priorité Opérationnelle</span>
        </button>
      </footer>
    </div>
  );
};

export default App;
