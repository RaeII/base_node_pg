/**
 * =========================================================================================
 * DECORATORS (Classes) vs HIGH ORDER FUNCTIONS (Funções Soltas)
 * =========================================================================================
 * 
 * Decorators com @ só funcionam em classes.
 * Para funções soltas, usamos "Composition" ou "High Order Functions" (HOF).
 * O conceito é IDÊNTICO: Uma função que recebe outra e retorna uma nova versão melhorada.
 */

// =========================================================================================
// 1. O ESTILO DECORATOR (Exclusivo de Classes)
// =========================================================================================

function LogDecorator(target: any, key: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    descriptor.value = function(...args: any[]) {
        console.log(`[DECORATOR] Executando ${key}...`);
        return original.apply(this, args);
    }
}

class ExemploClasse {
    @LogDecorator
    somar(a: number, b: number) {
        return a + b;
    }
}

// =========================================================================================
// 2. O ESTILO HIGH ORDER FUNCTION (Para Funções Soltas)
// Não existe @ para função, então fazemos na mão.
// =========================================================================================

// A HOF recebe a função original como argumento
function LogHOF(funcaoOriginal: Function) {
    return function(...args: any[]) {
        console.log(`[HOF] Executando função solta...`);
        return funcaoOriginal(...args);
    }
}

// Função normal (solta)
function multiplicar(a: number, b: number) {
    return a * b;
}

// "Decorando" a função manualmente
const multiplicarComLog = LogHOF(multiplicar);

// =========================================================================================
// TESTANDO
// =========================================================================================

console.log("--- Teste 1: Class Decorator ---");
const obj = new ExemploClasse();
console.log("Resultado:", obj.somar(10, 20));

console.log("\n--- Teste 2: High Order Function (Função Solta) ---");
console.log("Resultado:", multiplicarComLog(5, 5));

/**
 * RESUMO:
 * - @Decorator: Sintaxe especial do compilador (TS/Babel) para injetar código em classes.
 * - HOF (Wrapper): Padrão de projeto nativo do JS funcional. Decorator é basicamente uma HOF
 *   que o compilador aplica automaticamente para você.
 */
