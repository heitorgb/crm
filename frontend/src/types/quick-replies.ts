export interface QuickReply {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuickReplyInput {
  title: string;
  content: string;
}
