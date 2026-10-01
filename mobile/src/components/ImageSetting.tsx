import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useBusinessAsset, useDeleteBusinessAsset, useUploadBusinessAsset } from '../hooks/queries';
import { useSubmit } from '../hooks/useSubmit';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { prepareImage } from '../utils/prepare-image';
import { Button } from './Button';
import { Message } from './Message';

interface Props {
  kind: 'logo' | 'signature';
  label: string;
  path: string | null;
}

/** Pick (or remove) the business logo / signature shown on invoices and PDFs. */
export function ImageSetting({ kind, label, path }: Props) {
  const c = useTheme();
  const image = useBusinessAsset(kind, path);
  const upload = useUploadBusinessAsset(kind);
  const remove = useDeleteBusinessAsset(kind);
  const submit = useSubmit();
  const [notice, setNotice] = useState<string | null>(null);

  const pick = () =>
    submit.run(async () => {
      setNotice(null);
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setNotice('Allow photo access in your device settings to choose an image.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      const asset = res.canceled ? null : res.assets[0];
      if (!asset) return;
      const prepared = await prepareImage(
        asset.uri,
        async (u) => (await (await fetch(u)).blob()).size,
      );
      const blob = await (await fetch(prepared.uri)).blob();
      await upload.mutateAsync({ blob, contentType: prepared.contentType });
    });

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      {image.data ? (
        <Image
          source={{ uri: image.data }}
          style={{ width: 160, height: 60 }}
          resizeMode="contain"
          accessibilityLabel={`${label} preview`}
        />
      ) : (
        <Text style={{ color: c.muted }}>{path ? 'Loading…' : 'Not set'}</Text>
      )}
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
      {notice ? <Message kind="info">{notice}</Message> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            title={path ? `Change ${kind}` : `Choose ${kind}`}
            variant="secondary"
            onPress={pick}
            loading={submit.loading}
          />
        </View>
        {path ? (
          <View style={{ flex: 1 }}>
            <Button
              title="Remove"
              variant="secondary"
              onPress={() => void submit.run(() => remove.mutateAsync())}
              disabled={submit.loading}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}
