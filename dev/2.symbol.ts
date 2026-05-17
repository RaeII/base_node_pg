//npx ts-node --project dev/tsconfig.json dev/2.symbol.ts

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║            GUIA PRÁTICO DE SYMBOLS EM TYPESCRIPT                 ║
 * ║          O que são, por que usar e exemplos reais                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * O QUE É UM SYMBOL?
 * ──────────────────
 * Um Symbol é um tipo de dado ÚNICO e IMUTÁVEL. Mesmo que você crie
 * dois Symbols com a mesma descrição, eles NUNCA serão iguais.
 * 
 * Por que usar?
 * 1. Para criar chaves de propriedades que não conflitam com outras.
 * 2. Para "esconder" propriedades de iterações comuns (JSON.stringify, for...in).
 * 3. É a base de como bibliotecas como Reflect-metadata funcionam internamente.
 */

// 1. A Natureza Única do Symbol
console.log("═══════════════════════════════════════════════════");
console.log("  EXEMPLO 1: UNICIDADE");
console.log("═══════════════════════════════════════════════════");

const s1 = Symbol("descricao");
const s2 = Symbol("descricao");

console.log("Symbol 1:", String(s1));
console.log("Symbol 1:", s1);
console.log("Symbol 2:", String(s2));
console.log("Symbol 2:", s2);
// @ts-expect-error: O TS sabe que s1 e s2 são únicos, por isso avisa que a comparação sempre será false.
console.log("s1 === s2?", s1 === s2); // false! Cada um é único no universo.


// 2. Usando como Chave de Objeto (Propriedades "Privadas")
console.log("\n═══════════════════════════════════════════════════");
console.log("  EXEMPLO 2: PROPRIEDADES ESCONDIDAS");
console.log("═══════════════════════════════════════════════════");

// Imagine que queremos guardar um ID interno de sistema que não deve
// ser modificado por acidente ou aparecer em logs simples.
const CHAVE_INTERNA = Symbol("id_interno");
const CHAVE_INTERNA2 = Symbol("id_interno");


const usuario = {
  nome: "João Silva",
  email: "joao@email.com",
  [CHAVE_INTERNA]: "uuid-12345-abcde", // Chave dinâmica usando Symbol
  [CHAVE_INTERNA2]: "uuid-interna-2" // Chave dinâmica usando Symbol
};

console.log("Objeto Usuário:", usuario);
console.log("Acessando chave interna:", usuario[CHAVE_INTERNA]);
console.log("Acessando chave interna2:", usuario[CHAVE_INTERNA2]);

// Propriedades Symbol são ignoradas em iterações normais!
console.log("\nChaves visíveis (Object.keys):", Object.keys(usuario)); // ['nome', 'email']
console.log("JSON.stringify:", JSON.stringify(usuario)); // Não mostra o Symbol!


// 3. Compartilhando Symbols com Symbol.for()
console.log("\n═══════════════════════════════════════════════════");
console.log("  EXEMPLO 3: REGISTRO GLOBAL (Symbol.for)");
console.log("═══════════════════════════════════════════════════");

/**
 * Symbol.for() procura no "Registro Global" de Symbols.
 * Se já existir um com esse nome, ele REUSA. Se não, cria um novo.
 * Diferente de Symbol(), onde cada chamada cria um novo.
 */

const globalS1 = Symbol.for("app.token");
const globalS2 = Symbol.for("app.token");

// @ts-expect-error: Aqui o TS também reclama por achar que não há sobreposição, mas como usamos Symbol.for(), eles SÃO iguais.
console.log("globalS1 === globalS2?", globalS1 === globalS2); // true!


// 4. Exemplo Prático: Metadados estilo Decorators
console.log("\n═══════════════════════════════════════════════════");
console.log("  EXEMPLO 4: SIMULANDO METADADOS DE DECORATOR");
console.log("═══════════════════════════════════════════════════");

// No seu arquivo de decorators, usamos Symbols para marcar rotas.
// Isso garante que se outra biblioteca usar a classe, não vai apagar nossos dados por acidente.
const METADATA_ROUTE = Symbol("routes");

class MeuController {
  // O sistema de decorators faz isso por baixo dos panos:
  static [METADATA_ROUTE] = [
    { path: "/users", method: "GET" }
  ];
}

console.log("Metadados da classe:", MeuController[METADATA_ROUTE]);

/**
 * RESUMO:
 * Use Symbols quando precisar de chaves "seguras" que ninguém 
 * vai sobrescrever por erro e que devem ficar fora do fluxo principal
 * de visualização do objeto.
 */
