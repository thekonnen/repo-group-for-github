import { useEffect, useState } from 'preact/hooks';

/** The device code is public and short-lived; copying it does not expose the saved authorization token. */
export function DeviceCode({ code, className }: { code: string; className: string }) {
  const [feedback, setFeedback] = useState('');
  useEffect(() => setFeedback(''), [code]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setFeedback('Copied!');
    } catch {
      setFeedback('Could not copy. Select and copy the code.');
    }
  };

  return (
    <span class="rg-device-code-wrap">
      <button type="button" class={`${className} rg-device-code`} title="Copy sign-in code" aria-label={`Copy sign-in code ${code}`} onClick={() => void copy()}>{code}</button>
      <span class="rg-device-code-feedback" role="status">{feedback}</span>
    </span>
  );
}