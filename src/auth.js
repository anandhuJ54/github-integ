const AUTH_KEY = 'isAuthenticated';

export const SAMPLE_USERNAME = 'admin';
export const SAMPLE_PASSWORD = 'admin123';

export const isAuthenticated = () => localStorage.getItem(AUTH_KEY) === 'true';

export const login = (username, password) => {
  if (username === SAMPLE_USERNAME && password === SAMPLE_PASSWORD) {
    localStorage.setItem(AUTH_KEY, 'true');
    return true;
  }
  return false;
};

export const logout = () => {
  localStorage.removeItem(AUTH_KEY);
};
