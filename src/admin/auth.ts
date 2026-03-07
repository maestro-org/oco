import { randomUUID } from 'node:crypto';
import { ValidationError } from '../errors';
import { AdminRole, AuthSession } from './types';

interface Credential {
  username: string;
  password: string;
  role: AdminRole;
}

export class AuthService {
  private readonly credentials: Credential[];
  private readonly sessions = new Map<string, AuthSession>();

  constructor(credentials?: Credential[]) {
    this.credentials = credentials ?? defaultCredentials();
  }

  login(username: string, password: string): AuthSession {
    const normalizedUser = username.trim();
    const credential = this.credentials.find(
      (item) => item.username === normalizedUser && item.password === password,
    );
    if (!credential) {
      throw new ValidationError('invalid credentials');
    }

    const session: AuthSession = {
      token: randomUUID(),
      username: credential.username,
      role: credential.role,
      createdAt: new Date().toISOString(),
    };

    this.sessions.set(session.token, session);
    return session;
  }

  authenticate(token: string): AuthSession {
    const session = this.sessions.get(token);
    if (!session) {
      throw new ValidationError('unauthorized');
    }
    return session;
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }
}

function defaultCredentials(): Credential[] {
  const adminUser = process.env.OCO_ADMIN_USERNAME?.trim() || 'admin';
  const adminPassword = process.env.OCO_ADMIN_PASSWORD || 'admin';

  const output: Credential[] = [
    {
      username: adminUser,
      password: adminPassword,
      role: 'admin',
    },
  ];

  const operatorUser = process.env.OCO_OPERATOR_USERNAME?.trim();
  const operatorPassword = process.env.OCO_OPERATOR_PASSWORD;
  if (operatorUser && operatorPassword) {
    output.push({
      username: operatorUser,
      password: operatorPassword,
      role: 'operator',
    });
  }

  const viewerUser = process.env.OCO_VIEWER_USERNAME?.trim();
  const viewerPassword = process.env.OCO_VIEWER_PASSWORD;
  if (viewerUser && viewerPassword) {
    output.push({
      username: viewerUser,
      password: viewerPassword,
      role: 'viewer',
    });
  }

  return output;
}
