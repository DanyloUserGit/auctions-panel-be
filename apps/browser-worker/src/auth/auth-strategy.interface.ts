
import { Page } from 'playwright';

export interface AuthData {
  email?: string;
  password?: string;
}

export interface IAuthStrategy {
  readonly url: string; 
  
  login(page: Page, authData: AuthData): Promise<void>;
}