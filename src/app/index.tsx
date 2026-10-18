import { Redirect } from 'expo-router';

/** Default landing tab (functional spec §1). */
export default function Index() {
  return <Redirect href="/satellites" />;
}
