export type NativeHistoryEntry = {
  id?: string;
  role: string;
  text: string;
  activity?: string;
  title?: string;
  createdAt?: string;
  truncated?: boolean;
};

export type SpoolTurnEntry = {
  id: string;
  prompt: string;
  text?: string;
  status: string;
  createdAt?: number;
};

export function historyContainsUserTurn(
  messages: NativeHistoryEntry[],
  turn: SpoolTurnEntry,
): boolean;

export function historyContainsTurn(
  messages: NativeHistoryEntry[],
  turn: SpoolTurnEntry,
): boolean;

export function visibleSpoolTurns<T extends SpoolTurnEntry>(
  messages: NativeHistoryEntry[],
  turns: T[],
): T[];
