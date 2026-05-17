/**
 * =========================================================================================
 * ENTENDENDO OBJECT.DEFINEPROPERTY
 * =========================================================================================
 * 
 * O método Object.defineProperty(objeto, 'propriedade', descriptor) permite definir ou
 * modificar propriedades de um objeto com precisão cirúrgica.
 * 
 * Enquanto a atribuição normal (obj.prop = 1) cria uma propriedade "padrão" (que pode ser
 * alterada, deletada e vista em loops), o defineProperty nos dá controle total sobre:
 * 
 * 1. WRITABLE: Se o valor pode ser alterado.
 * 2. ENUMERABLE: Se a propriedade aparece em loops (for...in) ou Object.keys().
 * 3. CONFIGURABLE: Se a propriedade pode ser deletada ou reconfigurada depois.
 * 4. GET/SET: Funções executadas ao ler ou escrever o valor (Interceptor).
 */

// =========================================================================================
// EXEMPLO 1: PROPRIEDADE IMUTÁVEL (Read-Only)
// Simulando uma constante dentro de um objeto.
// =========================================================================================

const configSistema = {};

Object.defineProperty(configSistema, 'API_KEY', {
    value: 'X99-SECRET-KEY',
    writable: false,      // NÃO pode ser alterado
    enumerable: true,     // Aparece no console.log
    configurable: false   // NÃO pode ser deletado nem reconfigurado
});

console.log("--- Exemplo 1: Imutabilidade ---");
console.log("Valor original:", (configSistema as any).API_KEY);

// Tentando alterar (em strict mode isso lançaria erro, aqui apenas falha silenciosamente ou lança se for strict)
try {
    (configSistema as any).API_KEY = 'HACKED-KEY';
    console.log("Tentativa de alteração feita."); 
} catch (e: any) {
    console.log("Erro ao tentar alterar:", e.message);
}

console.log("Valor pós-tentativa:", (configSistema as any).API_KEY); // Continua o original

// =========================================================================================
// EXEMPLO 2: PROPRIEDADE "SECRET" (Não Enumerável)
// Útil para esconder dados internos de logs ou serialização JSON.
// =========================================================================================

const usuario = {
    id: 1,
    nome: "Rael"
};

Object.defineProperty(usuario, 'senhaHash', {
    value: 'a1b2c3d4e5',
    enumerable: false, // O Segredo! Não aparece em loops
    writable: true,
    configurable: true
});

console.log("\n--- Exemplo 2: Escondendo Propriedades ---");
console.log("Object.keys(usuario):", Object.keys(usuario)); // Só mostra 'id' e 'nome'
console.log("JSON.stringify(usuario):", JSON.stringify(usuario)); // Senha não vai no JSON!

console.log("Acessando diretamente:", (usuario as any).senhaHash); // Mas ainda existe e é acessível!

// =========================================================================================
// EXEMPLO 3: GETTERS E SETTERS (Validação e Reatividade)
// É AQUI QUE A MÁGICA ACONTECE! Frameworks reativos (Vue 2, MobX) usam isso.
// =========================================================================================

const produto = {
    _preco: 100, // Convenção: underline para "privado"
    nome: "Teclado Mecânico"
};

// Definindo 'preco' como uma interface pública para '_preco'
Object.defineProperty(produto, 'preco', {
    enumerable: true,
    configurable: true,
    
    get: function() {
        console.log(`[LOG] Alguém leu o preço: R$${this._preco}`);
        return this._preco;
    },
    
    set: function(novoValor) {
        if (novoValor < 0) {
            console.error(`[ERRO] Preço não pode ser negativo: ${novoValor}`);
            return;
        }
        if (typeof novoValor !== 'number') {
            console.error(`[ERRO] Preço deve ser um número.`);
            return;
        }
        
        console.log(`[LOG] Preço alterado de R$${this._preco} para R$${novoValor}`);
        this._preco = novoValor;
    }
});

console.log("\n--- Exemplo 3: Getters e Setters Inteligentes ---");

// Leitura (dispara o get)
const p = (produto as any).preco; 

// Escrita Válida (dispara o set)
(produto as any).preco = 150; 

// Escrita Inválida (Lógica de proteção)
(produto as any).preco = -50; 

console.log("Estado final do produto:", produto); 
// Note que o _preco mudou, mas o console.log do objeto
// pode mostrar [Getter/Setter] dependendo do ambiente
