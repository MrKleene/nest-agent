export interface ApiResponse<T> {
  data: T;
  meta: { requestId: string };
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: string[];
  };
  meta: { requestId: string };
}
