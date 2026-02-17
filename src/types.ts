export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type AnyMap = Record<string, unknown>;

export interface InstanceContext {
  id: string;
  inventoryPath: string;
  inventoryDir: string;
  generatedDir: string;
  configDir: string;
  stateDir: string;
  workspaceRoot: string;
  gatewayPort: number;
  gatewayBind: string;
}

export interface PolicyResult {
  scope: string;
  policy: AnyMap;
}
