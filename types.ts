
export enum Role {
  INFILTRÉ = 'INFILTRÉ',
  GARDE = 'GARDE',
  CODIS = 'CODIS',
  MJ = 'MJ'
}

export enum GameStatus {
  LOBBY = 'LOBBY',
  ACTIVE = 'ACTIVE',
  BIP_ALERTE = 'BIP_ALERTE',
  VOTING = 'VOTING',
  FINISHED = 'FINISHED'
}

export interface Player {
  id: string;
  name: string;
  role: Role;
  isNeutralised: boolean;
}

export interface SabotageState {
  isActive: boolean;
  startTime: number | null;
  targetId: string | null;
  // Added 'TRANSMITTING' to the allowed status values for upload feedback
  status: 'IDLE' | 'PENDING' | 'READY_FOR_UPLOAD' | 'TRANSMITTING' | 'COMPLETED' | 'DEJOUÉ';
  photoUri?: string;
}

export interface GameSession {
  code: string;
  players: Player[];
  status: GameStatus;
  sabotage: SabotageState;
  codisCheckUsed: boolean;
  alertMsg?: string;
}
