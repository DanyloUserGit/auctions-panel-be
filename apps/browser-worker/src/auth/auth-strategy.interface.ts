
import { Page } from 'playwright';

export interface AuthData {
  title?: string;
  email?: string;
  password?: string;
}

export interface IAuthStrategy {
  readonly url: string; 
  readonly isInteractive?: boolean;

  login(page: Page, authData: AuthData): Promise<void>;
}