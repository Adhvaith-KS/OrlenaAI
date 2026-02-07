export type MessageType = 'offer' | 'answer' | 'ice-candidate' | 'join';

export interface SignalMessage {
  type: MessageType;
  senderId: string;
  targetId?: string;
  data: any; // SDP or Candidate
}

export interface Room {
  id: string;
  participants: string[]; // max 2
  messages: { [userId: string]: SignalMessage[] }; // MessageBox for each user
  ttsModel?: string; // Room-level model selection
}
