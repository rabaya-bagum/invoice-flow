import { customerInputSchema } from '@invoiceflow/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { useCustomer, useDeleteCustomer, useSaveCustomer } from '../hooks/queries';
import { useFormFields } from '../hooks/useFormFields';
import { useSubmit } from '../hooks/useSubmit';
import type { CustomersStackParams } from '../navigation/types';
import { fieldErrors } from '../validation/fields';

const EMPTY = {
  firstName: '',
  lastName: '',
  companyName: '',
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  province: '',
  postalCode: '',
  country: '',
  notes: '',
};

export function CustomerFormScreen({
  route,
  navigation,
}: NativeStackScreenProps<CustomersStackParams, 'CustomerForm'>) {
  const id = route.params?.id;
  const existing = useCustomer(id);
  const save = useSaveCustomer(id);
  const remove = useDeleteCustomer();
  const { values, setValues, errors, setErrors, set } = useFormFields(EMPTY);
  const submit = useSubmit();

  useEffect(() => {
    if (existing.data) {
      const d = existing.data;
      setValues({
        firstName: d.firstName ?? '',
        lastName: d.lastName ?? '',
        companyName: d.companyName ?? '',
        email: d.email ?? '',
        phone: d.phone ?? '',
        addressLine1: d.addressLine1 ?? '',
        addressLine2: d.addressLine2 ?? '',
        city: d.city ?? '',
        province: d.province ?? '',
        postalCode: d.postalCode ?? '',
        country: d.country ?? '',
        notes: d.notes ?? '',
      });
    }
  }, [existing.data, setValues]);

  if (id && existing.isPending) return <LoadingState />;
  if (id && existing.isError)
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;

  const onSave = async () => {
    const { data, errors: e } = fieldErrors(customerInputSchema, values);
    setErrors(e);
    if (!data) return;
    const ok = await submit.run(async () => {
      await save.mutateAsync(data);
      return true;
    });
    if (ok) navigation.goBack();
  };

  const confirmDelete = () =>
    Alert.alert(
      'Delete customer?',
      'They will be removed from your customer list. Existing invoices are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            void submit.run(async () => {
              await remove.mutateAsync(id as string);
              navigation.popToTop();
            }),
        },
      ],
    );

  const field = (key: keyof typeof EMPTY, label: string, extra: object = {}) => (
    <TextField
      label={label}
      value={values[key]}
      onChangeText={set(key)}
      error={errors[key]}
      {...extra}
    />
  );

  return (
    <Screen centered={false}>
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
      {errors._ ? <Message kind="error">{errors._}</Message> : null}
      {field('firstName', 'First name', { autoComplete: 'given-name' })}
      {field('lastName', 'Last name', { autoComplete: 'family-name' })}
      {field('companyName', 'Company name')}
      {field('email', 'Email', {
        autoCapitalize: 'none',
        keyboardType: 'email-address',
        autoComplete: 'email',
      })}
      {field('phone', 'Phone', { keyboardType: 'phone-pad', autoComplete: 'tel' })}
      {field('addressLine1', 'Address')}
      {field('addressLine2', 'Address line 2')}
      {field('city', 'City')}
      {field('province', 'Province / State')}
      {field('postalCode', 'Postal / ZIP code', { autoCapitalize: 'characters' })}
      {field('country', 'Country')}
      {field('notes', 'Notes', { multiline: true })}
      <Button
        title={id ? 'Save changes' : 'Add customer'}
        onPress={onSave}
        loading={submit.loading}
      />
      {id ? (
        <Button
          title="Delete customer"
          variant="danger"
          onPress={confirmDelete}
          disabled={submit.loading}
        />
      ) : null}
    </Screen>
  );
}
