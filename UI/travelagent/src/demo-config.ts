// Demo login only. Configure service keys in Settings.
export const demoConfig = {
  account: {
    username: 'admin',
    password: '123456',
    displayName: 'Admin',
  },
  profile: {
    protocol: 'messages',
    baseURL: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-flash',
    headers: {},
  },
  secrets: {
    variflight: '',
    deepseek: '',
    amap: '',
    amapJs: '',
    amapSecurity: '',
    rollinggo: '',
    didi: '',
  },
} as const
