export interface User {
  id: string;
  name: string;
  email: string;
}

export interface UserRecord extends User {
  passwordHash: string;
}
