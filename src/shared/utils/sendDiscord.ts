import axios from "axios";
import { env } from "@/config";
import { getDateTimeBr } from "./getDateTimeBr";

class SendDiscord {

  urlWebhookDiscord: Map<string, string>;

  constructor(){
    this.urlWebhookDiscord = new Map()
    .set('APP_ERROR', env.DISCORD_WEBHOOK)
  }

  maxLength = (str:string,length = 1020 ) => {
  
    if (str.length > length) {
      const shortenedStr = str.slice(0, length) + " ...";
      return shortenedStr
    } 
  
    return str
  }



  field = async (message: string) => {
    const field = [
      {
        name: "**MESSAGE**",
        value: this.maxLength(message)
      }
    ];

    return field;
  }

  /**
   * Valida se o alert_id existe no mapa de webhooks
   */
  validateAlertId = (alertId: string): boolean => {
    return this.urlWebhookDiscord.has(alertId);
  }

  /**
   * Retorna lista de alertas disponíveis
   */
  getAvailableAlerts = (): string[] => {
    return Array.from(this.urlWebhookDiscord.keys());
  }

  /**
   * Envia um alerta genérico para o Discord
   */
  sendAlert = async (alertId: string, title: string, message: string) => {
    const field = await this.field(message);

    const fields = {
      EmbedTitle: this.getEmbedTitle(alertId),
      title: this.maxLength(title,100),
      userName: alertId,
      field: field
    };

    await this.sendDiscord(fields);
  }

  /**
   * Envia um erro detalhado para o Discord.
   * Extrai stack, error_request, message, etc. do objeto de erro.
   */
  sendErrorAlert = async (title: string, error: any) => {
    const field = await this.fieldLegacy(error);

    const fields = {
      EmbedTitle: this.getEmbedTitle('APP_ERROR'),
      title: title,
      userName: 'APP_ERROR',
      field: field
    };

    await this.sendDiscord(fields);
  }

  /**
   * Retorna o título do embed baseado no alert_id
   */
  private getEmbedTitle = (alertId: string): string => {
    const embedTitles: { [key: string]: string } = {
      'APP_ERROR': '🚨 APP ERROR 🚨'
    };

    return embedTitles[alertId] || `🔔 ${alertId.toUpperCase()} 🔔`;
  }


  private fieldLegacy = async (e:any) => {

    const field = []
  
    if((e?.error_message || false)) field.push({                     
      name: "**ERROR MESSAGE**",
      value: this.maxLength(e.error_message) 
    })

    if(e?.details || e?.data?.details || false) field.push({
      name: "**DETAILS**",
      value:this.maxLength(e?.details || e.data.details)
    })

    if(e?.message || false) field.push({
      name: "**MESSAGE**",
      value:this.maxLength(e.message)
    })

    if(e?.msg || false) field.push({
      name: "**MSG**",
      value:this.maxLength(e.msg)
    })

    if((e?.error_response || false) && typeof e.error_response === "string") field.push({
      name: "**ERROR REQUEST**",
      value: this.maxLength(e.error_response)
    })

    if((e?.error_request || false) && typeof e.error_request === "string") field.push({
      name: "**ERROR REQUEST**",
      value: this.maxLength(e.error_request)
    })

    if(e?.stack || false) field.push({
        name: "**STACK**",
        value: this.maxLength(e.stack)
    })
 
    return field

  }

  
  sendDiscord = async (fields:any) =>{

    const dateNow = await getDateTimeBr()
    
    const body =
    {
      content : `━━━━━━━** ${fields.EmbedTitle} **━━━━━━━\n`,
      embeds: [
        {
          timestamp:  new Date().toISOString(),
          author: {
            name: fields.userName,
            "icon_url" : "https://cdn-icons-png.flaticon.com/512/5974/5974693.png"
          },
          color: 697832,
          title: fields.title,
          fields: [
            ...fields.field,
            { name: '\u200B', value: '\u200B'},
            {
              name: "Date",
              value:  dateNow.format('YYYY-MM-DD'),
              inline: true
            },
            { name: '\u200B', value: '\u200B',inline: true},
            {
              name:  "Time",
              value:  dateNow.format('HH:mm'),
              inline: true
            },
          ]
        }
      ]
    }
      
    const webhook =  this.urlWebhookDiscord.get(fields.userName)

    await this.delay(1000);
               
    await axios.post(
      `https://discord.com/api/webhooks/${webhook}`,
      body
    )

  }

  delay = (ms:any) => {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

}

export default new SendDiscord();