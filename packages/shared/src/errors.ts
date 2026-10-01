export type MoneyErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_CURRENCY'
  | 'INVALID_QUANTITY'
  | 'INVALID_RATE'
  | 'INVALID_DISCOUNT'
  | 'INVALID_INPUT';

export class MoneyError extends Error {
  constructor(
    public readonly code: MoneyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MoneyError';
  }
}
