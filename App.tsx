
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
  const sessionRef = useRef<GameSession | null>(null);

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
  const [lastNotificationTime, setLastNotificationTime] = useState<string | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [sabotageTimeLeft, setSabotageTimeLeft] = useState<number>(SABOTAGE_TIMER_MS);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const broadcastSession = (newSession: GameSession) => {
    if (!isHost) return;
    setSession(newSession);
    const conns = Object.values(connectionsRef.current) as DataConnection[];
    conns.forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'SYNC_SESSION', payload: newSession });
      }
    });
  };

  const sendToHost = (type: string, payload: any) => {
    if (isHost) {
      handleClientAction(currentPlayer?.id || 'host', { type, payload });
      return;
    }
    const hostConn = (Object.values(connectionsRef.current) as DataConnection[])[0];
    if (hostConn && hostConn.open) {
      hostConn.send({ type, payload, senderId: currentPlayer?.id });
    }
  };

  const handleClientAction = (senderId: string, action: { type: string, payload: any }) => {
    if (!isHost) return;
    const current = sessionRef.current!;
    
    switch (action.type) {
      case 'JOIN':
        const newPlayer = action.payload as Player;
        if (!current.players.find(p => p.id === newPlayer.id)) {
          console.log(`[HOST] Nouveau joueur détecté: ${newPlayer.name}`);
          const updatedPlayers = [...current.players, newPlayer];
          broadcastSession({ ...current, players: updatedPlayers });
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
            if(sessionRef.current) broadcastSession({ ...sessionRef.current, alertMsg: undefined });
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

  const handleCreateGame = () => {
    setErrorMessage(null);
    setIsHost(true);
    setConnectionStatus('CONNECTING');
    
    const admin: Player = { 
      id: 'host-' + Math.random().toString(36).substr(2, 4), 
      name: inputName || 'ADMIN_MJ', 
      role: Role.MJ, 
      isNeutralised: false 
    };
    setCurrentPlayer(admin);
    setSession({
      code: '',
      players: [admin],
      status: GameStatus.LOBBY,
      sabotage: { isActive: false, startTime: null, targetId: null, status: 'IDLE' },
      codisCheckUsed: false
    });

    const p = new Peer();
    peerRef.current = p;

    p.on('open', (id) => {
      setPeerId(id);
      setInputCode(id);
      setConnectionStatus('CONNECTED');
      setSession(prev => ({ ...prev, code: id }));
    });

    p.on('connection', (conn) => {
      console.log(`[HOST] Canal entrant: ${conn.peer}`);
      conn.on('open', () => {
        connectionsRef.current[conn.peer] = conn;
        // Synchro forcée au branchement
        conn.send({ type: 'SYNC_SESSION', payload: sessionRef.current });
      });

      conn.on('data', (data: any) => {
        if (data && data.type) {
          handleClientAction(data.senderId || conn.peer, data);
        }
      });

      conn.on('close', () => {
        delete connectionsRef.current[conn.peer];
        // Optionnel : Retirer le joueur de la liste s'il se déconnecte au lobby
        if (sessionRef.current?.status === GameStatus.LOBBY) {
           const updated = sessionRef.current.players.filter(p => !p.id.includes(conn.peer));
           setSession(prev => ({ ...prev, players: updated }));
        }
      });
    });

    p.on('error', (err) => {
      setErrorMessage(`Erreur Serveur: ${err.type}`);
      setConnectionStatus('DISCONNECTED');
    });
  };

  const handleJoinGame = () => {
    const cleanCode = inputCode.trim();
    if (!cleanCode) {
      setErrorMessage("Code session manquant");
      return;
    }
    setErrorMessage(null);
    setIsHost(false);
    setConnectionStatus('CONNECTING');

    const playerId = 'unit-' + Math.random().toString(36).substr(2, 4);
    const player: Player = { id: playerId, name: inputName || 'GARDE', role: Role.GARDE, isNeutralised: false };
    setCurrentPlayer(player);
    
    const p = new Peer();
    peerRef.current = p;

    p.on('open', (myId) => {
      console.log(`[CLIENT] Mon ID: ${myId}, tentative vers MJ: ${cleanCode}`);
      const conn = p.connect(cleanCode, { reliable: true });
      
      const timeout = setTimeout(() => {
        if (connectionStatus !== 'CONNECTED') {
          setErrorMessage("Échec de liaison au MJ. Vérifiez le code.");
          setConnectionStatus('DISCONNECTED');
          p.destroy();
        }
      }, 10000);

      conn.on('open', () => {
        clearTimeout(timeout);
        console.log(`[CLIENT] Canal Ouvert avec MJ`);
        connectionsRef.current[cleanCode] = conn;
        setConnectionStatus('CONNECTED');
        setPeerId(myId);
        
        // Petit délai technique pour laisser le MJ enregistrer ses listeners
        setTimeout(() => {
           conn.send({ type: 'JOIN', payload: player, senderId: playerId });
        }, 500);
      });

      conn.on('data', (data: any) => {
        if (data.type === 'SYNC_SESSION') {
          setSession(data.payload);
        }
      });

      conn.on('error', (err) => {
        setErrorMessage("Erreur de transmission.");
        setConnectionStatus('DISCONNECTED');
      });

      conn.on('close', () => {
        setConnectionStatus('DISCONNECTED');
        setErrorMessage("Liaison rompue avec le Central.");
      });
    });

    p.on('error', (err) => {
      if (err.type === 'peer-not-found') setErrorMessage("Session introuvable.");
      else setErrorMessage(`Init Error: ${err.type}`);
      setConnectionStatus('DISCONNECTED');
    });
  };

  useEffect(() => {
    const checkTime = () => {
      const now = new Date();
      const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      if (CHRONOGRAM_TIMES.includes(timeStr) && timeStr !== lastNotificationTime) {
        setLastNotificationTime(timeStr);
        if (isHost) broadcastSession({ ...sessionRef.current!, alertMsg: `CHRONOGRAMME : ${timeStr}` });
      }
    };
    const timer = setInterval(checkTime, 15000);
    return () => clearInterval(timer);
  }, [lastNotificationTime, isHost]);

  useEffect(() => {
    if (currentPlayer && session.status === GameStatus.ACTIVE && !briefing) {
      const p = session.players.find(pl => pl.id === currentPlayer.id);
      if (p) {
        generateBriefing(p.role, p.name).then(setBriefing);
      }
    }
  }, [session.status, currentPlayer]);

  useEffect(() => {
    if (session.sabotage.isActive && session.sabotage.startTime && session.sabotage.status === 'PENDING') {
      const timer = setInterval(() => {
        const elapsed = Date.now() - (session.sabotage.startTime || 0);
        const remaining = Math.max(0, SABOTAGE_TIMER_MS - elapsed);
        setSabotageTimeLeft(remaining);

        if (remaining <= 0 && isHost) {
          broadcastSession({
            ...sessionRef.current!,
            sabotage: { ...sessionRef.current!.sabotage, status: 'READY_FOR_UPLOAD' }
          });
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
        setErrorMessage("Attente de renforts (Min 1 agent)...");
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
            <h1 className="text-4xl font-bold tracking-tighter italic glow-neon mb-2 uppercase">Opération Scellé</h1>
            <p className="text-[9px] opacity-60 uppercase tracking-[0.5em] font-black text-[#F0FF00]">Système Tactique de Garde</p>
        </div>
        
        {errorMessage && (
          <div className="bg-red-950/70 border-l-4 border-red-500 p-3 text-[10px] text-red-200 font-bold uppercase animate-pulse">
            <span className="text-red-500 mr-2">[!]</span> {errorMessage}
          </div>
        )}

        {connectionStatus !== 'CONNECTED' && !isHost ? (
          <HUDFrame title="Initialisation Unité">
            <div className="space-y-4 py-4">
              <input 
                value={inputName} onChange={e => setInputName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 p-4 text-[#F0FF00] placeholder:opacity-20 outline-none text-sm font-mono tracking-widest focus:border-[#F0FF00]" 
                placeholder="IDENTIFIANT POMPIER" 
              />
              <div className="grid grid-cols-2 gap-4 pt-2">
                <button 
                    disabled={connectionStatus === 'CONNECTING'}
                    onClick={handleCreateGame} 
                    className="border-2 border-[#F0FF00] p-4 text-xs font-black uppercase tracking-widest hover:bg-[#F0FF00] hover:text-[#0A192F] transition-all disabled:opacity-30"
                >
                    POSTE MJ
                </button>
                <div className="flex flex-col space-y-2">
                   <input 
                    value={inputCode} 
                    onChange={e => setInputCode(e.target.value)}
                    className="bg-slate-900 border border-slate-700 p-2 text-[#F0FF00] placeholder:opacity-20 outline-none text-[10px] font-mono focus:border-[#F0FF00]" 
                    placeholder="CODE SESSION" 
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
          <HUDFrame title={isHost ? "Terminal Central (MJ)" : "Unité Mobile (Pompiers)"}>
            <div className="space-y-4 py-4 text-center">
              <div className="bg-slate-900/80 p-4 border border-slate-700 shadow-inner">
                <p className="text-[10px] opacity-40 uppercase mb-2 font-black tracking-widest">Canal de Liaison P2P</p>
                <p className="text-2xl font-mono font-black tracking-[0.2em] text-[#F0FF00] select-all">
                    {session.code || peerId || "ÉTABLISSEMENT..."}
                </p>
                <p className="text-[8px] mt-3 opacity-30 italic">Communiquez ce code aux autres agents de garde</p>
              </div>
              
              <div className="flex justify-between items-center px-1">
                 <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Unités actives : {session.players.length}</span>
                 <div className="flex space-x-1">
                    {[...Array(Math.min(5, session.players.length))].map((_,i) => <div key={i} className="w-1 h-3 bg-[#F0FF00]"></div>)}
                 </div>
              </div>

              <ul className="space-y-1 text-[11px] max-h-48 overflow-y-auto text-left font-mono border-t border-slate-800 pt-2">
                {session.players.map(p => (
                  <li key={p.id} className="flex justify-between items-center border-b border-slate-900/50 py-3">
                    <span className={p.id === currentPlayer?.id ? "text-[#F0FF00] font-bold" : "text-slate-400"}>
                        {p.id === currentPlayer?.id ? "● " : "○ "}{p.name}
                    </span>
                    <span className={`text-[8px] px-2 py-0.5 border rounded uppercase font-black ${p.role === Role.MJ ? 'border-red-500 text-red-500' : 'border-slate-700 text-slate-500'}`}>
                        {p.role === Role.MJ ? 'CENTRAL' : 'UNITÉ'}
                    </span>
                  </li>
                ))}
              </ul>

              {isHost && (
                <button 
                    onClick={handleStartGame} 
                    disabled={session.players.length < 2} 
                    className="w-full mt-6 bg-[#F0FF00] text-[#0A192F] p-5 font-black tracking-[0.3em] text-sm uppercase disabled:opacity-20 shadow-[0_0_30px_rgba(240,255,0,0.2)] hover:scale-[1.02] transition-transform active:scale-95"
                >
                    ACTIVER RÉSEAU DE GARDE
                </button>
              )}
              {!isHost && (
                <div className="py-6 flex flex-col items-center">
                    <div className="w-8 h-8 border-4 border-[#F0FF00] border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-[9px] uppercase tracking-[0.4em] text-blue-400 font-black animate-pulse">Attente des ordres du central...</p>
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
      <header className="h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/95 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className={`w-2 h-2 rounded-full ${connectionStatus === 'CONNECTED' ? 'bg-green-500 animate-pulse shadow-[0_0_10px_#22c55e]' : 'bg-red-500 shadow-[0_0_10px_#ef4444]'}`}></div>
          <div className="flex flex-col"><span className="text-[8px] opacity-40 font-bold uppercase tracking-widest">Agent</span><span className="text-[10px] font-black">{currentPlayer?.name}</span></div>
        </div>
        <div className="flex flex-col items-center"><span className="text-[8px] opacity-40 font-bold uppercase tracking-widest">Secteur</span><span className="text-[10px] font-black text-[#F0FF00] font-mono">{session.code?.substring(0,8) || "---"}</span></div>
        <div className="flex flex-col items-end"><span className="text-[8px] opacity-40 font-bold uppercase tracking-widest">Phase</span><span className="text-[10px] font-black uppercase text-blue-400">{session.status}</span></div>
      </header>

      {session.status === GameStatus.BIP_ALERTE && (
        <div className="fixed inset-0 z-[100] bg-red-950/98 flex flex-col items-center justify-center p-8 text-center border-[8px] border-red-600 animate-pulse">
          <div className="scale-150 mb-8">{RETICLE_ICON}</div>
          <h2 className="text-6xl font-black text-white italic mb-6 glow-red uppercase tracking-tighter">ALERTE BIP</h2>
          <p className="text-sm text-red-200 tracking-[0.5em] uppercase mb-16 font-black">Suspension Immédiate des Fonctions</p>
          {isHost && (
            <button onClick={() => sendToHost('BIP_RELEASE', null)} className="border-4 border-white text-white px-12 py-6 font-black text-xl hover:bg-white hover:text-red-900 transition-all shadow-2xl uppercase tracking-[0.2em] active:scale-90">
                REPRENDRE
            </button>
          )}
        </div>
      )}

      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col items-center justify-center text-center p-8 border-[12px] border-green-500 animate-neon-green">
           <h2 className="text-6xl font-black text-green-400 italic mb-4 glow-green uppercase tracking-tighter">SABOTAGE RÉUSSI</h2>
           <p className="text-2xl font-black tracking-[0.6em] text-green-100 uppercase">Scellé compromis</p>
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-4 space-y-5 pb-32">
        {session.alertMsg && (
          <div className="bg-red-950/40 border border-red-600 p-4 text-[10px] font-black uppercase text-red-500 animate-pulse flex items-center space-x-4">
            <div className="w-4 h-4 bg-red-600 rounded-full animate-ping flex-shrink-0"></div>
            <span className="leading-tight">{session.alertMsg}</span>
          </div>
        )}

        <HUDFrame title="Données Opérationnelles" variant={currentPlayer?.role === Role.INFILTRÉ ? 'alert' : 'neon'}>
          <div className="flex justify-between items-center mb-4">
            <h3 className={`text-3xl font-black italic tracking-tighter uppercase ${roleColor}`}>{currentPlayer?.role}</h3>
            <div className="animate-spin duration-[10000ms]">{RETICLE_ICON}</div>
          </div>
          <div className="bg-slate-900/60 p-5 border-l-4 border-[#F0FF00] min-h-[80px] shadow-inner">
             <p className="text-[12px] font-mono leading-relaxed text-slate-200 italic whitespace-pre-wrap">{briefing || "Décryptage du dossier en cours... Liaison CODIS active."}</p>
          </div>
        </HUDFrame>

        {currentPlayer?.role === Role.INFILTRÉ && (
          <div className="space-y-4">
            {session.sabotage.status === 'IDLE' && (
               <button onClick={() => sendToHost('SABOTAGE_START', null)} className="w-full bg-red-600 text-white p-7 font-black uppercase tracking-[0.4em] text-sm shadow-[0_15px_30px_rgba(255,0,0,0.5)] active:translate-y-1 transition-all">LANCER SABOTAGE</button>
            )}
            {session.sabotage.status === 'PENDING' && (
               <HUDFrame title="Compte à rebours Latence" variant="alert">
                  <div className="text-7xl font-black text-center text-red-500 font-mono py-8 tracking-[0.2em] glow-red">
                    {Math.floor(sabotageTimeLeft/1000/60)}:{Math.floor((sabotageTimeLeft/1000)%60).toString().padStart(2,'0')}
                  </div>
                  <p className="text-[9px] text-center opacity-60 uppercase font-black tracking-[0.3em]">Phase d'approche furtive active</p>
               </HUDFrame>
            )}
            {session.sabotage.status === 'READY_FOR_UPLOAD' && (
              <HUDFrame title="Validation Neutralisation" variant="alert">
                <div className="space-y-4">
                  {!capturedPhoto ? (
                    <div className="h-64 bg-slate-900/40 border-4 border-dashed border-red-600 flex flex-col items-center justify-center relative hover:bg-red-900/10 transition-colors">
                      <input type="file" accept="image/*" capture="environment" onChange={(e) => {
                         const file = e.target.files?.[0];
                         if (file) {
                           const r = new FileReader();
                           r.onloadend = () => setCapturedPhoto(r.result as string);
                           r.readAsDataURL(file);
                         }
                      }} className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" />
                      <div className="text-center p-4">
                        <div className="text-red-600 mb-4 flex justify-center scale-[2]">{RETICLE_ICON}</div>
                        <p className="text-[12px] font-black text-red-400 uppercase tracking-[0.2em]">Cliquer pour scanner le scellé scellé</p>
                      </div>
                    </div>
                  ) : (
                    <div className="relative aspect-square border-4 border-green-500 shadow-2xl bg-black">
                       <img src={capturedPhoto} className="w-full h-full object-contain" alt="Scan" />
                       <div className="absolute inset-0 bg-green-500/10 animate-pulse pointer-events-none"></div>
                       <button onClick={() => setCapturedPhoto(null)} className="absolute top-4 right-4 bg-red-600 px-4 py-2 text-[10px] font-black uppercase shadow-lg">ÉCHEC SCAN</button>
                    </div>
                  )}
                  <button onClick={() => {
                     setShowSuccessOverlay(true);
                     setTimeout(() => setShowSuccessOverlay(false), 3000);
                     sendToHost('SABOTAGE_COMPLETE', capturedPhoto);
                     setCapturedPhoto(null);
                  }} disabled={!capturedPhoto} className="w-full bg-red-600 text-white p-6 font-black uppercase tracking-[0.2em] text-sm disabled:opacity-30 transition-all shadow-[0_10px_20px_rgba(255,0,0,0.3)]">TRANSMETTRE AU CENTRAL</button>
                </div>
              </HUDFrame>
            )}
          </div>
        )}

        {currentPlayer?.role !== Role.MJ && currentPlayer?.role !== Role.INFILTRÉ && (
           <HUDFrame title="Module de Surveillance" variant={session.sabotage.isActive ? 'alert' : 'muted'}>
              <button 
                onClick={() => sendToHost('SABOTAGE_REPORT', null)} 
                disabled={!session.sabotage.isActive}
                className={`w-full p-6 font-black uppercase tracking-[0.3em] text-[10px] border-4 transition-all ${session.sabotage.isActive ? 'border-red-600 text-red-500 animate-pulse bg-red-950/30' : 'border-slate-800 text-slate-700 opacity-60'}`}
              >
                {session.sabotage.isActive ? "SABOTAGE DÉTECTÉ ! SIGNALER AU MJ" : "ZÉRO MENACE EN COURS"}
              </button>
           </HUDFrame>
        )}

        {currentPlayer?.role === Role.CODIS && (
           <HUDFrame title="Terminal Renseignement">
             {!session.codisCheckUsed ? (
               <div className="space-y-4">
                 <div className="relative">
                    <select id="codis-sel" className="w-full bg-slate-900 border-2 border-slate-700 p-4 text-[13px] text-[#F0FF00] font-mono outline-none appearance-none focus:border-[#F0FF00]">
                      <option value="">-- CHOISIR UNE UNITÉ --</option>
                      {session.players.filter(p => p.id !== currentPlayer.id && p.role !== Role.MJ).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">▼</div>
                 </div>
                 <button onClick={async () => {
                   const tid = (document.getElementById('codis-sel') as HTMLSelectElement).value;
                   if(!tid) return;
                   const target = session.players.find(p => p.id === tid);
                   if(!target) return;
                   const report = await analyzeIntel(currentPlayer.name, target.name);
                   setIntelReport(`OBJET : ${target.name}\nANALYSE : ${report}\nCONCLUSION : ${target.role === Role.INFILTRÉ ? 'INFILTRÉ CONFIRMÉ' : 'UNITÉ ALLIÉE'}`);
                   if (isHost) broadcastSession({ ...session, codisCheckUsed: true });
                   else sendToHost('CODIS_USE', null);
                 }} className="w-full bg-blue-700 text-white p-5 font-black text-xs tracking-[0.3em] uppercase shadow-lg hover:bg-blue-600 active:scale-95 transition-all">LANCER ANALYSE BIOMÉTRIQUE</button>
               </div>
             ) : (
               <div className="bg-blue-900/30 p-5 border-l-4 border-blue-500 font-mono text-[11px] text-blue-200 leading-relaxed italic shadow-inner">
                 {intelReport || "DONNÉES ÉPUISÉES. TERMINAL VERROUILLÉ."}
               </div>
             )}
           </HUDFrame>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 p-4 bg-[#0A192F]/98 backdrop-blur-2xl border-t-2 border-slate-800 z-[90] shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        <button 
          onClick={() => sendToHost(session.status === GameStatus.BIP_ALERTE ? 'BIP_RELEASE' : 'BIP_TRIGGER', null)}
          className="w-full h-24 bg-red-600 rounded-2xl flex flex-col items-center justify-center shadow-[0_-8px_40px_rgba(255,0,0,0.5)] active:scale-95 transition-all border-b-[10px] border-red-900 active:border-b-0 hover:brightness-110"
        >
          <span className="text-3xl font-black text-white glow-red italic tracking-tighter uppercase mb-1">ALERTE BIP</span>
          <span className="text-[10px] text-red-100 font-black uppercase tracking-[0.5em] opacity-90 animate-pulse">Urgence Absolue</span>
        </button>
      </footer>
    </div>
  );
};

export default App;
