export function isExternalServicesDisabled(): boolean {
  return process.env.EXTERNAL_SERVICES_DISABLED === 'true' || process.env.NODE_ENV === 'test';
}

export interface MockPushRecord {
  tokens: string[];
  title: string;
  body: string;
  data?: any;
  timestamp: string;
}

export const mockPushLog: MockPushRecord[] = [];

export function recordMockPush(tokens: string[], title: string, body: string, data?: any): void {
  mockPushLog.push({
    tokens,
    title,
    body,
    data,
    timestamp: new Date().toISOString(),
  });
}

export function clearMockPushLog(): void {
  mockPushLog.length = 0;
}
