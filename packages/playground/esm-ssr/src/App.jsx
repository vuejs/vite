import { render } from 'preact-render-to-string';

export function App() {
  return (
    <>
      <p>Hello Vite + Preact!</p>
      <p>
        <a
          class="link"
          href="https://preactjs.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn Preact
        </a>
      </p>
    </>
  )
}

export async function prerender() {
	return await render(<App />);
}
