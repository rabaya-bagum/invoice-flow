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
};

export type MoreStackParams = {
  More: undefined;
  BusinessProfile: undefined;
  ProductList: undefined;
  ProductForm: { id?: string } | undefined;
  TaxRates: undefined;
  Settings: undefined;
};

export type TabParams = {
  HomeTab: undefined;
  InvoicesTab: NavigatorScreenParams<InvoicesStackParams>;
  CustomersTab: NavigatorScreenParams<CustomersStackParams>;
  PaymentsTab: undefined;
  MoreTab: NavigatorScreenParams<MoreStackParams>;
};
