type ErrorCollection = {
  [key: string]: string | ((param?: string) => string);
};

type SuccessCollection = {
  [key: string]: string | ((param?: string) => string);
};

const errorCollection: ErrorCollection = {
  missingField: (field) => `Campo ${field} não pode ser vazio`,
  missingData: (data) => `Dado ${data} não fornecido`,
  registryNotFound: (entity) => `${entity} não encontrado`,
  invalidField: (field) => `Campo ${field} inválido`,
  notFound: (field) => `Registro não encontrado: ${field}`,
  alreadyExists: (field) => `Registro já existe: ${field}`,
  userAlreadyExist: 'Usuário já existe',
  emailAlreadyExist: 'E-mail já utilizado',
  noValidDataFound: 'Nenhum dado válido encontrado para atualização',
  walletNotFound: 'Carteira não encontrada.',
  clubAlreadyExist: 'Nome de clube já existe',
  clubAlreadyHasStadium: 'Clube já possui um estádio',
  stadiumNotBelongsToHomeClub: 'Estádio não pertence ao clube mandante',
  establishmentAlreadyInStadium: 'Este estabelecimento já está vinculado a este estádio',
  invalidCredentials: 'Senha ou e-mail inválidos',
};

const successCollection: SuccessCollection = {
  create: (entity) => `${entity} criado com sucesso`,
  update: (entity) => `${entity} atualizado com sucesso`,
  delete: (entity) => `${entity} removido com sucesso`
};

const getErrorStatusCode = (label: string): number => {
  switch (label) {
    case 'notFound':
      return 404;
    case 'badRequest':
      return 400;
    case 'unauthorized':
      return 401;
    case 'forbidden':
      return 403;
    default:
      return 500;
  }
};

function getErrorMessage(key: string, param?: string): string {
  const message = errorCollection[key];
  if (typeof message === 'function') {
    return message(param);
  }
  return message;
}

function getSuccessMessage(key: string, param?: string): string {
  const message = successCollection[key];
  if (typeof message === 'function') {
    return message(param);
  }
  return message;
}

export {
  getErrorMessage,
  getSuccessMessage,
  getErrorStatusCode
}; 