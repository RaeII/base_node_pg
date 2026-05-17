/**
 * npx ts-node dev/5.apply.ts
 * =========================================================================================
 * ENTENDENDO O MÉTODO .APPLY()
 * =========================================================================================
 *
 * O método .apply() é irmão do .call() e do .bind().
 * Ele tem uma função simples: CHAMAR uma função, mas definindo 
 * manualmente QUEM É O 'THIS' e PASSANDO ARGUMENTOS COMO UMA LISTA (ARRAY).
 *
 * A GRANDE DIFERENÇA DO .APPLY() vs .CALL():
 * - .call(this, arg1, arg2, arg3) -> Argumentos passados um a um, separados por vírgula.
 * - .apply(this, [arg1, arg2, arg3]) -> Argumentos passados JUNTOS em um ARRAY.
 *
 * Mnemônico útil: 
 * "A" de Apply = "A" de Array.
 * "C" de Call = "C" de Comma (Vírgula).
 */

// =========================================================================================
// EXEMPLO 1: EMPRESTANDO MÉTODOS (Mudando o contexto 'this')
// Imagine que você quer usar um método de um objeto em outro que não tem aquele método.
// =========================================================================================

const pessoaRica = {
    nome: "Elon",
    saldo: 1000000,
    mostrarSaldo: function(moeda: string, emoji: string) {
        console.log(`${emoji} ${this.nome} tem ${moeda} ${this.saldo}`);
    }
};

const pessoaPobre = {
    nome: "Estagiário",
    saldo: 10
};

console.log("--- Exemplo 1: Emprestando Métodos (Mudando o 'this') ---");

// A pessoa rica usa seu próprio método normalmente (o 'this' é ela mesma)
pessoaRica.mostrarSaldo("USD", "💰");

// O estagiário não tem o método 'mostrarSaldo'.
// Usamos .apply para rodar o método da rica, mas FORÇANDO o 'this' a ser o pobre.
// IMPORTANTE: Os argumentos ("BRL", "💸") são passados DENTRO DE UM ARRAY [ ].
pessoaRica.mostrarSaldo.apply(pessoaPobre, ["BRL", "💸"]);

// Comparação com .call() (dá no mesmo, só muda a sintaxe):
// pessoaRica.mostrarSaldo.call(pessoaPobre, "BRL", "💸");


// =========================================================================================
// EXEMPLO 2: ARRAYS COMO ARGUMENTOS (Onde o apply brilha ou brilhava)
// Como passar um array inteiro para uma função que espera argumentos separados?
// =========================================================================================

console.log("\n--- Exemplo 2: Apply com Arrays (Math.max) ---");

const numeros = [5, 6, 2, 3, 7];

// Math.max espera argumentos soltos: Math.max(1, 2, 3)
// Se passarmos o array direto Math.max(numeros), dá erro ou NaN dependendo do ambiente.

// 1. SOLUÇÃO CLÁSSICA (com apply):
// O primeiro argumento (this) é null pois Math.max é estático e não usa 'this'.
// O segundo argumento é o ARRAY que será "desembrolhado" para a função.
const maiorNumeroApply = Math.max.apply(null, numeros);
console.log("Maior número (com apply):", maiorNumeroApply);

// 2. SOLUÇÃO MODERNA (ES6 Spread Operator):
// O apply foi muito substituído por isso, mas é bom conhecer o legado.
const maiorNumeroSpread = Math.max(...numeros);
console.log("Maior número (com Spread ...):", maiorNumeroSpread);


// =========================================================================================
// EXEMPLO 3: DECORATORS E WRAPPERS (O uso real e moderno)
// Aqui o apply é FUNDAMENTAL para criar middlewares que funcionam com QUALQUER função.
// =========================================================================================

console.log("\n--- Exemplo 3: Wrappers Genéricos em Decorators ---");

// Uma função que envolve outra para adicionar log, sem saber quantos argumentos ela tem.
function logWrapper(funcaoOriginal: Function) {
    return function(this: any, ...argsRecebidos: any[]) {
        console.log(`[WRAPPER] Chamando função com ${argsRecebidos.length} argumentos.`);
        
        // AQUI ESTÁ O SEGREDO DO SUCESSO:
        // Não sabemos quantos argumentos a 'funcaoOriginal' pede.
        // Não sabemos quem é o 'this' (pode ser uma classe, um objeto, etc).
        // O .apply(this, argsRecebidos) repassa TUDO (contexto e dados) perfeitamente.
        // Se usássemos .call(), teríamos que espalhar os argumentos: .call(this, ...args)

        console.log("this --- ", this);
        console.log("argsRecebidos --- ", argsRecebidos);
        
        const resultado = funcaoOriginal.apply({}, argsRecebidos);
        
        console.log("[WRAPPER] Execução finalizada.");
        return resultado;
    };
}

// Simulando uma classe com um método
const calculadora = {
    nome: "CalcMaster 3000",
    somar(a: number, b: number) {
        // 'this.nome' prova que o contexto foi preservado
        console.log("this.nome --- ", this.nome);
        console.log(`[${this.nome}] Executando soma: ${a} + ${b}`);
        return a + b;
    }
};

// Substituindo o método original pelo wrapper
// (Isso é basicamente o que um Decorator faz por baixo dos panos)
const somarComLog = logWrapper(calculadora.somar);

// Ao chamar, o 'this' se perderia se não tratássemos.
// Mas como usamos .apply(this) dentro do wrapper, e chamamos como método do objeto...
// Vamos ver o comportamento:

// OBS: Aqui precisamos usar o .bind ou chamar direto no objeto se substituíssemos na classe.
// Como é um objeto literal, vamos simular a substituição direta:
calculadora.somar = logWrapper(calculadora.somar);

// Agora chamamos normalmente:
calculadora.somar(10, 20); 
