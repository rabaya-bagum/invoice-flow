import type { Account, AccountRepository } from '../repositories/account-repository';
import { AppError } from '../utils/errors';
import type { AuthUser } from './token-verifier';

export interface AccountService {
  getMe(user: AuthUser): Promise<Account & { email?: string }>;
  deleteAccount(user: AuthUser, ip?: string): Promise<void>;
}

export function createAccountService(repo: AccountRepository): AccountService {
  async function load(user: AuthUser) {
    const account = await repo.findByUserId(user.id);
    // A verified token with no profile means the signup trigger has not run or data was removed.
    if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
    return account;
  }

  return {
    async getMe(user) {
      return { ...(await load(user)), email: user.email };
    },

    async deleteAccount(user, ip) {
      const account = await load(user);
      // Written first: business_id is set null by the cascade, the log itself survives.
      await repo.recordAudit({
        businessId: account.business.id,
        userId: user.id,
        action: 'account.delete',
        ip,
      });
      await repo.deleteUser(user.id);
    },
  };
}
