export {};

declare global {
  type McpPilotState = 'online' | 'offline' | 'starting' | 'error';

  interface McpPilotStatus {
    state: McpPilotState;
    endpoint: string;
    managedByElectron: boolean;
    pid: number | null;
    error: string | null;
  }

  type MlEngineState = 'online' | 'offline' | 'starting' | 'error';

  interface MlEngineStatus {
    state: MlEngineState;
    endpoint: string;
    managedByElectron: boolean;
    pid: number | null;
    error: string | null;
  }

  interface Window {
    electronAPI?: {
      getMcpStatus: () => Promise<McpPilotStatus>;
      startMcpPilot: () => Promise<McpPilotStatus>;
      stopMcpPilot: () => Promise<McpPilotStatus>;
      getMlStatus: () => Promise<MlEngineStatus>;
      startMlEngine: () => Promise<MlEngineStatus>;
      stopMlEngine: () => Promise<MlEngineStatus>;
    };
  }
}
