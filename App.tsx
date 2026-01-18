
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
    (Object.values(connectionsRef.current) as DataConnection[]).forEach(conn => {
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
          broadcastSession({ ...current, players: [...current.players, newPlayer] });
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
    setSession(prev => ({ ...prev, players: [admin] }));

    const p = new Peer();
    peerRef.current = p;

    p.on('open', (id) => {
      setPeerId(id);
      setInputCode(id);
      setConnectionStatus('CONNECTED');
    });

    p.on('connection', (conn) => {
      conn.on('open', () => {
        connectionsRef.current[conn.peer] = conn;
        conn.send({ type: 'SYNC_SESSION', payload: sessionRef.current });
      });
      conn.on('data', (data: any) => handleClientAction(data.senderId, data));
      conn.on('close', () => {
        delete connectionsRef.current[conn.peer];
      });
    });

    p.on('error', (err) => {
      setErrorMessage(`Erreur Serveur: ${err.type}`);
      setConnectionStatus('DISCONNECTED');
    });
  };

  const handleJoinGame = () => {
    if (!inputCode) {
      setErrorMessage("Code requis");
      return;
    }
    setErrorMessage(null);
    setIsHost(false);
    setConnectionStatus('CONNECTING');

    const id = 'player-' + Math.random().toString(36).substr(2, 4);
    const player: Player = { id, name: inputName || 'GARDE', role: Role.GARDE, isNeutralised: false };
    setCurrentPlayer(player);
    
    const p = new Peer();
    peerRef.current = p;

    p.on('open', () => {
      const conn = p.connect(inputCode, { reliable: true });
      
      const connectionTimeout = setTimeout(() => {
        if (connectionStatus !== 'CONNECTED') {
          setErrorMessage("Délai de connexion dépassé. Vérifiez le code.");
          setConnectionStatus('DISCONNECTED');
          p.destroy();
        }
      }, 10000);

      conn.on('open', () => {
        clearTimeout(connectionTimeout);
        connectionsRef.current[inputCode] = conn;
        setConnectionStatus('CONNECTED');
        setPeerId(p.id);
        conn.send({ type: 'JOIN', payload: player });
      });

      conn.on('data', (data: any) => {
        if (data.type === 'SYNC_SESSION') {
          setSession(data.payload);
        }
      });

      conn.on('error', (err) => {
        setErrorMessage("Échec de la connexion au MJ.");
        setConnectionStatus('DISCONNECTED');
      });

      conn.on('close', () => {
        setConnectionStatus('DISCONNECTED');
        setErrorMessage("Connexion perdue avec le MJ.");
      });
    });

    p.on('error', (err) => {
      if (err.type === 'peer-not-found') {
        setErrorMessage("Code de session introuvable.");
      } else {
        setErrorMessage(`Erreur: ${err.type}`);
      }
      setConnectionStatus('DISCONNECTED');
    });
  };

  useEffect(() => {
    const checkTime = () => {
      const now = new Date();
      const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      if (CHRONOGRAM_TIMES.includes(timeStr) && timeStr !== lastNotificationTime) {
        setLastNotificationTime(timeStr);
        if (isHost) broadcastSession({ ...session, alertMsg: `CHRONOGRAMME : ${timeStr}` });
      }
    };
    const timer = setInterval(checkTime, 10000);
    return () => clearInterval(timer);
  }, [lastNotificationTime, isHost, session]);

  useEffect(() => {
    if (currentPlayer && session.status === GameStatus.ACTIVE && !briefing) {
      const p = session.players.find(pl => pl.id === currentPlayer.id);
      if (p) {
        generateBriefing(p.role, p.name).then(setBriefing);
      }
    }
  }, [session.status, currentPlayer, session.players]);

  useEffect(() => {
    if (session.sabotage.isActive && session.sabotage.startTime && session.sabotage.status === 'PENDING') {
      const timer = setInterval(() => {
        const elapsed = Date.now() - (session.sabotage.startTime || 0);
        const remaining = Math.max(0, SABOTAGE_TIMER_MS - elapsed);
        setSabotageTimeLeft(remaining);

        if (remaining <= 0 && isHost) {
          broadcastSession({
            ...session,
            sabotage: { ...session.sabotage, status: 'READY_FOR_UPLOAD' }
          });
          clearInterval(timer);
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [session.sabotage.isActive, session.sabotage.startTime, session.sabotage.status, isHost, session]);

  const handleStartGame = () => {
    if (!isHost) return;
    const players = [...session.players];
    const nonAdmin = players.filter(p => p.role !== Role.MJ);
    if (nonAdmin.length < 2) {
        setErrorMessage("Il faut au moins 2 agents + 1 MJ");
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
            <h1 className="text-4xl font-bold tracking-tighter italic glow-neon mb-2">OPÉRATION SCELLÉ</h1>
            <p className="text-[10px] opacity-50 uppercase tracking-[0.4em] font-bold">Reseau Tactique P2P</p>
        </div>
        
        {errorMessage && (
          <div className="bg-red-950/50 border border-red-500 p-3 text-[10px] text-red-400 font-bold text-center uppercase animate-pulse">
            {errorMessage}
          </div>
        )}

        {connectionStatus !== 'CONNECTED' && !isHost ? (
          <HUDFrame title="Init. Terminal">
            <div className="space-y-4 py-4">
              <input 
                value={inputName} onChange={e => setInputName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 p-3 text-[#F0FF00] placeholder:opacity-30 outline-none text-sm font-mono" 
                placeholder="IDENTIFIANT (NOM)" 
              />
              <div className="grid grid-cols-2 gap-4 pt-4">
                <button 
                    disabled={connectionStatus === 'CONNECTING'}
                    onClick={handleCreateGame} 
                    className="border border-[#F0FF00] p-4 text-xs font-black uppercase tracking-widest hover:bg-[#F0FF00] hover:text-[#0A192F] transition-all disabled:opacity-50"
                >
                    {connectionStatus === 'CONNECTING' && isHost ? 'INIT...' : 'CRÉER MJ'}
                </button>
                <div className="flex flex-col space-y-2">
                   <input 
                    value={inputCode} 
                    onChange={e => setInputCode(e.target.value)} // Pas de toUpperCase() ici
                    className="bg-slate-900 border border-slate-700 p-2 text-[#F0FF00] placeholder:opacity-30 outline-none text-[10px] font-mono" 
                    placeholder="CODE REÇU" 
                   />
                   <button 
                    disabled={connectionStatus === 'CONNECTING'}
                    onClick={handleJoinGame} 
                    className="border border-slate-500 p-2 text-[10px] font-black uppercase tracking-widest hover:bg-slate-500 hover:text-white transition-all disabled:opacity-50"
                   >
                    {connectionStatus === 'CONNECTING' && !isHost ? 'CONNEXION...' : 'REJOINDRE'}
                   </button>
                </div>
              </div>
            </div>
          </HUDFrame>
        ) : (
          <HUDFrame title={isHost ? "Terminal Maître" : "Terminal Esclave"}>
            <div className="space-y-4 py-4 text-center">
              <div className="bg-slate-900 p-3 border border-slate-700 relative group">
                <p className="text-[10px] opacity-40 uppercase mb-1">Code de Liaison</p>
                <p className="text-xl font-mono font-bold tracking-widest text-[#F0FF00] break-all selection:bg-[#F0FF00] selection:text-[#0A192F]">
                    {session.code || peerId}
                </p>
                <p className="text-[8px] mt-2 opacity-30 italic">Partagez ce code avec les autres pompiers</p>
              </div>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Effectif détecté : {session.players.length}</div>
              <ul className="space-y-1 text-[11px] max-h-48 overflow-y-auto text-left font-mono">
                {session.players.map(p => (
                  <li key={p.id} className="flex justify-between border-b border-slate-800 py-2">
                    <span className={p.id === currentPlayer?.id ? "text-[#F0FF00]" : "text-slate-300"}>
                        {p.id === currentPlayer?.id ? "> " : ""}{p.name}
                    </span>
                    <span className="opacity-40 text-[9px]">{p.role === Role.MJ ? 'CENTRAL' : 'UNITÉ'}</span>
                  </li>
                ))}
              </ul>
              {isHost && (
                <button 
                    onClick={handleStartGame} 
                    disabled={session.players.length < 2} 
                    className="w-full mt-4 bg-[#F0FF00] text-[#0A192F] p-4 font-black tracking-widest text-xs uppercase disabled:opacity-20 shadow-[0_0_15px_rgba(240,255,0,0.3)]"
                >
                    INITIALISER LA GARDE
                </button>
              )}
              {!isHost && (
                <div className="py-4">
                    <div className="w-4 h-4 border-2 border-[#F0FF00] border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <p className="text-[10px] uppercase tracking-widest text-blue-400">En attente des ordres du MJ...</p>
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
      <header className="h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/90 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className={`w-2 h-2 rounded-full ${connectionStatus === 'CONNECTED' ? 'bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]' : 'bg-red-500'}`}></div>
          <div className="flex flex-col"><span className="text-[8px] opacity-40 font-bold uppercase tracking-widest">Opérateur</span><span className="text-[10px] font-bold">{currentPlayer?.name}</span></div>
        </div>
        <div className="flex flex-col items-center"><span className="text-[8px] opacity-40 font-bold uppercase tracking-widest">Secteur</span><span className="text-[10px] font-bold text-[#F0FF00] font-mono">{session.code?.substring(0,6) || "---"}</span></div>
        <div className="flex flex-col items-end"><span className="text-[8px] opacity-40 font-bold uppercase tracking-widest">Statut</span><span className="text-[10px] font-bold uppercase">{session.status}</span></div>
      </header>

      {session.status === GameStatus.BIP_ALERTE && (
        <div className="fixed inset-0 z-[100] bg-red-950/95 flex flex-col items-center justify-center p-8 text-center border-4 border-red-600 animate-pulse">
          <h2 className="text-5xl font-black text-white italic mb-4 glow-red uppercase tracking-tighter">ALERTE BIP</h2>
          <p className="text-sm text-red-200 tracking-[0.3em] uppercase mb-12 font-bold">Interruption Opérationnelle</p>
          {isHost && (
            <button onClick={() => sendToHost('BIP_RELEASE', null)} className="border-4 border-white text-white px-10 py-5 font-black text-lg hover:bg-white hover:text-red-900 transition-all shadow-2xl">
                REPRENDRE LA GARDE
            </button>
          )}
        </div>
      )}

      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col items-center justify-center text-center p-8 border-[12px] border-green-500 animate-neon-green">
           <h2 className="text-6xl font-black text-green-400 italic mb-4 glow-green uppercase">SABOTAGE RÉUSSI</h2>
           <p className="text-xl font-bold tracking-[0.5em] text-green-100">SCELLÉ NEUTRALISÉ</p>
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
        {session.alertMsg && (
          <div className="bg-red-950/40 border border-red-600 p-3 text-[10px] font-black uppercase text-red-500 animate-pulse flex items-center space-x-3">
            <span className="w-3 h-3 bg-red-600 rounded-full animate-ping"></span>
            <span>{session.alertMsg}</span>
          </div>
        )}

        <HUDFrame title="Données de Mission" variant={currentPlayer?.role === Role.INFILTRÉ ? 'alert' : 'neon'}>
          <div className="flex justify-between items-center mb-3">
            <h3 className={`text-3xl font-black italic tracking-tighter uppercase ${roleColor}`}>{currentPlayer?.role}</h3>
            {RETICLE_ICON}
          </div>
          <div className="bg-slate-900/80 p-4 border-l-4 border-[#F0FF00] min-h-[60px]">
             <p className="text-[12px] font-mono leading-relaxed text-slate-300 italic whitespace-pre-wrap">{briefing || "Décryptage en cours... Veuillez patienter."}</p>
          </div>
        </HUDFrame>

        {currentPlayer?.role === Role.INFILTRÉ && (
          <div className="space-y-4">
            {session.sabotage.status === 'IDLE' && (
               <button onClick={() => sendToHost('SABOTAGE_START', null)} className="w-full bg-red-600 text-white p-6 font-black uppercase tracking-[0.3em] text-sm shadow-[0_10px_20px_rgba(255,0,0,0.4)] active:translate-y-1 transition-all">LANCER SABOTAGE</button>
            )}
            {session.sabotage.status === 'PENDING' && (
               <HUDFrame title="Compte à rebours Latence" variant="alert">
                  <div className="text-6xl font-black text-center text-red-500 font-mono py-6 tracking-widest">
                    {Math.floor(sabotageTimeLeft/1000/60)}:{Math.floor((sabotageTimeLeft/1000)%60).toString().padStart(2,'0')}
                  </div>
                  <p className="text-[9px] text-center opacity-50 uppercase font-bold tracking-widest">Neutralisation du scellé en cours...</p>
               </HUDFrame>
            )}
            {session.sabotage.status === 'READY_FOR_UPLOAD' && (
              <HUDFrame title="Transmission de Preuve" variant="alert">
                <div className="space-y-4">
                  {!capturedPhoto ? (
                    <div className="h-56 bg-slate-900/60 border-4 border-dashed border-red-600 flex flex-col items-center justify-center relative hover:bg-red-900/10 transition-colors">
                      <input type="file" accept="image/*" capture="environment" onChange={(e) => {
                         const file = e.target.files?.[0];
                         if (file) {
                           const r = new FileReader();
                           r.onloadend = () => setCapturedPhoto(r.result as string);
                           r.readAsDataURL(file);
                         }
                      }} className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" />
                      <div className="text-center">
                        <div className="text-red-500 mb-3 flex justify-center scale-150">{RETICLE_ICON}</div>
                        <p className="text-[11px] font-black text-red-400 uppercase tracking-[0.2em]">Cliquer pour scanner scellé</p>
                      </div>
                    </div>
                  ) : (
                    <div className="relative aspect-square border-4 border-green-500 shadow-2xl">
                       <img src={capturedPhoto} className="w-full h-full object-cover" alt="Scan" />
                       <button onClick={() => setCapturedPhoto(null)} className="absolute top-3 right-3 bg-red-600 px-3 py-1 text-[10px] font-black uppercase">ANNULER</button>
                    </div>
                  )}
                  <button onClick={() => {
                     setShowSuccessOverlay(true);
                     setTimeout(() => setShowSuccessOverlay(false), 3000);
                     sendToHost('SABOTAGE_COMPLETE', capturedPhoto);
                     setCapturedPhoto(null);
                  }} disabled={!capturedPhoto} className="w-full bg-red-600 text-white p-5 font-black uppercase tracking-widest text-sm disabled:opacity-20 transition-all">VALIDER LA NEUTRALISATION</button>
                </div>
              </HUDFrame>
            )}
          </div>
        )}

        {currentPlayer?.role !== Role.MJ && currentPlayer?.role !== Role.INFILTRÉ && (
           <HUDFrame title="Contre-Infiltration" variant={session.sabotage.isActive ? 'alert' : 'muted'}>
              <button 
                onClick={() => sendToHost('SABOTAGE_REPORT', null)} 
                disabled={!session.sabotage.isActive}
                className={`w-full p-5 font-black uppercase tracking-widest text-xs border-4 transition-all ${session.sabotage.isActive ? 'border-red-600 text-red-500 animate-pulse bg-red-950/20' : 'border-slate-800 text-slate-700 opacity-50 cursor-not-allowed'}`}
              >
                {session.sabotage.isActive ? "SIGNALER SABOTAGE EN COURS !" : "AUCUN SABOTAGE DÉTECTÉ"}
              </button>
           </HUDFrame>
        )}

        {currentPlayer?.role === Role.CODIS && (
           <HUDFrame title="Archives Renseignement">
             {!session.codisCheckUsed ? (
               <div className="space-y-4">
                 <select id="codis-sel" className="w-full bg-slate-900 border-2 border-slate-700 p-3 text-[12px] text-[#F0FF00] font-mono outline-none focus:border-blue-500">
                   <option value="">-- SÉLECTIONNER CIBLE --</option>
                   {session.players.filter(p => p.id !== currentPlayer.id && p.role !== Role.MJ).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                 </select>
                 <button onClick={async () => {
                   const tid = (document.getElementById('codis-sel') as HTMLSelectElement).value;
                   if(!tid) return;
                   const target = session.players.find(p => p.id === tid);
                   if(!target) return;
                   const report = await analyzeIntel(currentPlayer.name, target.name);
                   setIntelReport(`DOSSIER : ${target.name}\nANALYSES : ${report}\nCONCLUSION : ${target.role === Role.INFILTRÉ ? 'CIBLE HOSTILE' : 'CIBLE ALLIÉE'}`);
                   if (isHost) broadcastSession({ ...session, codisCheckUsed: true });
                   else sendToHost('CODIS_USE', null);
                 }} className="w-full bg-blue-600 text-white p-4 font-black text-xs tracking-[0.2em] uppercase shadow-lg">LANCER INVESTIGATION (UNIQUE)</button>
               </div>
             ) : (
               <div className="bg-blue-900/30 p-4 border-l-4 border-blue-500 font-mono text-[11px] text-blue-300 leading-relaxed shadow-inner">
                 {intelReport || "DONNÉES INDISPONIBLES. CANAL FERMÉ."}
               </div>
             )}
           </HUDFrame>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 p-4 bg-[#0A192F]/95 backdrop-blur-xl border-t-2 border-slate-800 z-[90]">
        <button 
          onClick={() => sendToHost(session.status === GameStatus.BIP_ALERTE ? 'BIP_RELEASE' : 'BIP_TRIGGER', null)}
          className="w-full h-20 bg-red-600 rounded-xl flex flex-col items-center justify-center shadow-[0_-5px_30px_rgba(255,0,0,0.4)] active:scale-95 transition-all border-b-8 border-red-900 active:border-b-0"
        >
          <span className="text-2xl font-black text-white glow-red italic tracking-tighter uppercase">ALERTE BIP</span>
          <span className="text-[9px] text-red-100 font-bold uppercase tracking-[0.4em] opacity-80">Urgence Opérationnelle</span>
        </button>
      </footer>
    </div>
  );
};

export default App;
