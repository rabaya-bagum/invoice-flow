import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParams = {
  Login: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
  VerifyEmail: { email: string };
};

export type CustomersStackParams = {
  CustomerList: undefined;
  CustomerDetail: { id: string };
  CustomerForm: { id?: string } | undefined;
};

export type InvoicesStackParams = {
  InvoiceList: undefined;
  Invoice: { id?: string } | undefined;
  SendInvoice: { id: string };
};

export type PaymentsStackParams = {
  PaymentList: undefined;
  PaymentDetail: { id: string };
};

export type MoreStackParams = {
  More: undefined;
  BusinessProfile: undefined;
  ProductList: undefined;
  ProductForm: { id?: string } | undefined;
  TaxRates: undefined;
  OnlinePayments: undefined;
  Notifications: undefined;
  Settings: undefined;
};

export type TabParams = {
  HomeTab: undefined;
  InvoicesTab: NavigatorScreenParams<InvoicesStackParams>;
  CustomersTab: NavigatorScreenParams<CustomersStackParams>;
  PaymentsTab: NavigatorScreenParams<PaymentsStackParams>;
  MoreTab: NavigatorScreenParams<MoreStackParams>;
};
