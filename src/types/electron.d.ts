export {};

declare global {
  type McpPilotState = 'online' | 'offline' | 'starting' | 'error';

  interface McpPilotStatus {
    state: McpPilotState;
    endpoint: string;
    managedByElectron: boolean;
    pid: number | null;
    error: string | null;
    wsAuthReady: boolean;
  }

  interface Window {
    electronAPI?: {
      getMcpStatus: () => Promise<McpPilotStatus>;
      startMcpPilot: () => Promise<McpPilotStatus>;
      stopMcpPilot: () => Promise<McpPilotStatus>;
    };
  }
}
