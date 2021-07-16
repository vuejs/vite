export default function Env() {
  let msg = 'default message here';
  try {
    msg = process.env.MY_CUSTOM_SECRET || msg;
  } catch {}
  return <h1>{msg}</h1>
}
