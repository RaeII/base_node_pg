import * as moment from 'moment-timezone';

export const getDateTimeBr = async (date = "") => {

    // Define a data e hora em UTC
    const utcDateTime = date ? new Date(date) : new Date()

    // Define o fuso horário de Brasília
    const brasiliaTimeZone = 'America/Sao_Paulo';

    // Cria um objeto Moment.js com a data e hora em UTC
    const momentUtc = moment.utc(utcDateTime);

    // Converte para o horário de Brasília
    const momentBrasilia = momentUtc.tz(brasiliaTimeZone);

    return momentBrasilia
}