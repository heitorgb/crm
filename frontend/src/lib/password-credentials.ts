interface PasswordCredentialConstructor {
  new (data: { id: string; password: string; name?: string }): Credential;
}

type WindowWithPasswordCredential = Window & {
  PasswordCredential?: PasswordCredentialConstructor;
};

export async function storePasswordCredential(email: string, password: string): Promise<void> {
  if (!window.isSecureContext) {
    return;
  }

  const PasswordCredential = (window as WindowWithPasswordCredential).PasswordCredential;
  if (!PasswordCredential || !navigator.credentials) {
    return;
  }

  try {
    const credential = new PasswordCredential({
      id: email,
      name: email,
      password,
    });

    await navigator.credentials.store(credential);
  } catch {
    return;
  }
}
