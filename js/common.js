const remote = require('electron').remote;
const bootstrap = require('bootstrap');
const fs = require('fs');
const QRCode = require('qrcode');
const domtoimage = require('dom-to-image');
const wnd = remote.getCurrentWindow();
const PDFDocument = require('pdfkit');
const blobStream = require('blob-stream');
const fileSaver = require('file-saver');

const pdfCreator = (function(){
    async function printSinglePage(page){
        return await domtoimage.toPng(page)
            .then(async (data) => {
                if (data)
                    return data
                else
                    return null;
            }).catch((error)=>{
                bills.setError(error.message);
            });
    }
    async function create(){
        let pages = document.querySelectorAll('.bill-item');
        if (pages.length === 0)
            return;
        let addr = pages[0].getAttribute('data-house-addr');
        let blobArray = [];
        for (const page of pages) {
            let item = await printSinglePage(page);
            blobArray.push(item);
        }
        Promise.all(blobArray).then((data)=>{
            // Здесь создается первая страница документа, поэтому добавлять нужно на одну меньше
            const doc = new PDFDocument({size: 'A4', layout: 'portrait', bufferPages: true});
            let stream = doc.pipe(blobStream());
            for (let i = 1; i < data.length; i ++){
                doc.addPage({size: 'A4', layout: 'portrait'});
            }
            const range = doc.bufferedPageRange();
            for (let i = range.start; i < range.count; i++) {
                doc.switchToPage(i);
                paintSinglePage(doc, data[i]);
            }
            doc.end();
            stream.on('finish', function() {
                const result = stream.toBlobURL('application/pdf');
                fileSaver.saveAs(result, `${bills.getPrefs().output}\\${addr}.pdf`);
            });
        });
    };
    function paintSinglePage(doc, data){
        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#fff');
        doc.image(data, 0, 6, {
            fit: [850, doc.page.width],
            align: 'left',
            valign: 'top'
        });
        doc.page.margins = {
            top: 0,
            left: 0,
            bottom: 0,
            right: 0
        };
    }
    return Object.freeze({create} );
})();
const bills =(function(){
    const dataDir = './data';
    const months = {
        1: 'Январь',
        2: 'Февраль',
        3: 'Март',
        4: 'Апрель',
        5: 'Май',
        6: 'Июнь',
        7: 'Июль',
        8: 'Август',
        9: 'Сентябрь',
        10: 'Октябрь',
        11: 'Ноябрь',
        12: 'Декабрь'
    }
    const preparedData = {
        houseDict: {},
        serviceDict: {},
        errors: [],
        preferences: {
            beginDate: null,
            endDate: null,
            organization: null
        }
    }
    let storedPref = {
        output: null,
        executor: {
            name: null,
            address: null,
            phones: null,
            site: null,
            email: null,
            work_time: null,
            gis_id: null,
            inn: null,
            bank: null,
            calc_acc: null,
            corr_acc: null,
            bik: null
        },
        recipient: {
            name: null,
            bank: null,
            inn: null,
            calc_acc: null,
            corr_acc: null,
            bik: null,
            kpp: null
        }
    }

    function parseDate(date){
        let parts = date.split('-');
        return {
            year: parseInt(parts[0]),
            month: parseInt(parts[1]),
            day: parseInt(parts[2])
        };
    }
    function dateToString(date){
        return `${date.day.toString().padStart(2, '0')}.${date.month.toString().padStart(2, '0')}.${date.year}`;
    }
    function buildHouseDict(data){
        preparedData.houseDict = {};
        preparedData.serviceDict = data.ServiceObjects;
        preparedData.errors = data.Errors;
        preparedData.preferences = {
            beginDate: parseDate(data.BeginDate),
            endDate: parseDate(data.EndDate),
            organization: data.OrganizationId
        };

        for (const [key, value] of Object.entries(data.Accounts)) {
            if (!value.IsAccountClosed && !value.IsHouseClosed) {
                let accounts = {};
                value.printed = false;
                accounts[key] = value;
                let house = preparedData.houseDict[value.HouseInfoId];
                if (!house) {
                    preparedData.houseDict[value.HouseInfoId] = {
                        address: value.AddressName,
                        data: accounts,
                        printed: false
                    }
                } else {
                    house.data[key] = value;
                }
            }
        }
        rewriteData();
        load();
    }
    function rewriteData(){
        let json = JSON.stringify(preparedData);
        if (!fs.existsSync(dataDir)){
            fs.mkdirSync(dataDir);
        }

        if (fs.existsSync(`${dataDir}/account.data`)){
            fs.unlinkSync(`${dataDir}/account.data`);
        }

        fs.writeFileSync(`${dataDir}/account.data`, json);
        return true;
    }
    function readBills(name){
        let obj = JSON.parse(fs.readFileSync(name, 'utf8'));
        buildHouseDict(obj);
    }
    function load(){
        if (fs.existsSync(`./pref/pref.json`)){
            storedPref = JSON.parse(fs.readFileSync(`./pref/pref.json`, 'utf8'));
            let inputs = document.querySelectorAll('.stored-pref');
            inputs.forEach((item)=>{
                let attr = item.getAttribute('data-field-name');
                let words = attr.split('.');
                if (words.length === 1){
                    item.value = storedPref[words[0]];
                } else {
                    item.value = storedPref[words[0]][words[1]];
                }
            });
        }
        let title = document.getElementById('app-title');
        title.innerText = `${storedPref.executor.name} (печать квитанций)`;

        if (!fs.existsSync(`${dataDir}/account.data`))
            return;
        let data = JSON.parse(fs.readFileSync(`${dataDir}/account.data`, 'utf8'));

        preparedData.houseDict = data.houseDict;
        preparedData.serviceDict = data.serviceDict;
        preparedData.errors = data.errors;
        preparedData.preferences = data.preferences;

        let html = '';

        let houses = Object.entries(data.houseDict);
        let notPrintedHouses = houses.map(i => i[1]).filter(i => i.printed === false).length;

        let counts = 0;
        let notPrintedCounts = 0;
        for (const [key, value] of houses) {
            counts += Object.keys(value.data).length;
            notPrintedCounts += Object.values(value.data).filter(i => i.printed === false).length;
            html += `<div class="content-data-row" data-house-id="${key}">
                        <div>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" value="" data-count-length="${Object.keys(value.data).length}">
                            </div>
                        </div>
                        <div>${value.address}</div>
                        <div class="acc-count">${Object.keys(value.data).length} л.с.</div>
                        <div class="icon check-icon" style=${value.printed ? "display:block" : "display:none"}>
                            <i class="fa fa-check" aria-hidden="true"></i>
                        </div>
                    </div>`;
        }
        document.querySelector('.info-decimal[data-decimal-type="begin-date"]').innerText = dateToString(data.preferences.beginDate);
        document.querySelector('.info-decimal[data-decimal-type="end-date"]').innerText = dateToString(data.preferences.endDate);

        document.querySelector('.info-decimal[data-decimal-type="all-houses"]').innerText = houses.length;
        document.querySelector('.info-decimal[data-decimal-type="not-printed-houses"]').innerText = notPrintedHouses;
        document.querySelector('.info-decimal[data-decimal-type="all-counts"]').innerText = counts;
        document.querySelector('.info-decimal[data-decimal-type="not-printed-counts"]').innerText = notPrintedCounts;

        let grid = document.getElementById('houseGrid');
        grid.innerHTML = html;

        grid.querySelectorAll("input.form-check-input").forEach((elem) => {
            elem.addEventListener('click', checkHouseItem);
        });

        document.getElementById('errorList').innerHTML = '';
        data.errors.forEach((item)=>{
            setError(item)
        })
    }
    function setError(err){
        let area = document.getElementById('errorList');
        area.innerHTML += `<div class="alert alert-danger error-list-item" role="alert">${err}</div>`;
        let cnt = area.querySelectorAll('.error-list-item').length;
        let tab = document.getElementById('errors-tab');
        tab.innerText = `Ошибки (${cnt})`;
    }
    function print(){
        let all = document.querySelectorAll('.form-check-input');
        all.forEach((item)=>{
           if (item.checked){
               let row = item.closest('.content-data-row');
               let id = row.getAttribute('data-house-id');
               if (printHouse(id)){
                   // Пометить распечатанным
                   row.querySelector('.check-icon').style = 'display:block';
                   item.checked = false;
                   checkHouseItem();
               }
           }
        });
        let pages = document.querySelectorAll('.bill-item');
        document.getElementById('btnSavePdf').disabled = pages.length === 0;
        if (pages.length === 0){
            return false;
        } else {
            return rewriteData();
        }
    }
    function printHouse(id){
        let area = document.querySelector('.pages-area');
        area.innerHTML = '';
        let houseData = preparedData.houseDict[id];
        let result = false;
        for (const [key, value] of Object.entries(houseData.data)){
            result = printBill(value, key);
            if (!result){
                break;
            }
        }

        let qrArr = document.querySelectorAll(`canvas.qr-code`);
        qrArr.forEach((qr)=>{
           let key = qr.getAttribute('data-acc-key');
           let bill = houseData.data[key];
           let val = qrValue(bill);
           QRCode.toCanvas(qr, val);
        });

        if (!result)
            return false;
        houseData.printed = true;
        return true;
        // в PDF
    }

    function png(){
        let page = document.querySelector('.bill-item');
        domtoimage.toJpeg(page)
            .then(function (blob) {
                var link = document.createElement('a');
                link.download = 'my-image-name.jpeg';
                link.href = blob;
                link.click();
            });
    }
    function printBill(bill, key){
        let payments = serviseRows(bill);
        let html = `<div class="bill-item" data-house-addr="${bill.AddressName}">
            <div class="payer-info">
                <div class="base-text period-info">
                    <div>Счет на оплату ЖКУ за</div>
                    <div>${period()}</div>
                </div>
            </div>
            <div class="bill-info-grid">
                <div class="bill-all-info">
                    <div class="bill-info-text">
                        <div class="bill-info-text-row">Сведения о плательщике услуг</div>
                        <div class="bill-info-text-row bold-row">Плательщик: ${bill.OwnerSurname} ${bill.OwnerName} ${bill.OwnerMiddleName}</div>
                        <div class="bill-info-text-row bold-row">Адрес: ${bill.AddressName} кв. ${bill.FlatNumber}</div>
                    </div>
                    <div></div>
                    <div class="bill-info-executor">
                        <div class="bill-info-executor-row">Площадь помещения: ${bill.TotalArea} Количество проживающих/собственников: ${bill.LodgerCount}</div>
                        <div class="bill-info-executor-row">Исполнитель услуг: ${storedPref.executor.name}</div>
                        <div class="bill-info-executor-row">Адрес: ${storedPref.executor.address}</div>
                        <div class="bill-info-executor-row">Банковские реквизиты исполнителя: р/с ${storedPref.executor.calc_acc} ${storedPref.executor.bank}, к/с ${storedPref.executor.corr_acc}, БИК ${storedPref.executor.bik}</div>
                        <div class="bill-info-executor-row">Сайт: ${storedPref.executor.site}    Эл.почта: ${storedPref.executor.email}</div>
                        <div class="bill-info-executor-row bill-info-executor-wt">
                            <div>Режим работы:</div>
                            <div>${storedPref.executor.work_time}</div>
                            <div>Телефон:</div>
                            <div>${storedPref.executor.phones}</div>
                        </div>
                        <div class="bill-info-executor-row">Единый лицевой счет ГИС ЖКХ: ${storedPref.executor.gis_id}</div>
                        <div style="padding: 0 5px 0 5px;">Идентификатор платежного документа ГИС ЖКХ: ${bill.GisGkhUniqueServiceNumber}</div>
                    </div>
                </div>                
                <div class="bill-info-qr">
                    <canvas id="qr-${bill.PersonalAccountId}" data-acc-key="${key}" class="qr-code"></canvas>
                </div>
            </div>
            <p class="bill-font-1 bill-step-h1">Информация для внесения платыполучателю платежа (получателям платежей)</p>
            <div class="header-info">
                <div class="bill-font-2 cell-bottom-border cell-right-border">Наименование получателя платежа</div>
                <div class="bill-font-2 cell-bottom-border cell-right-border">Номер банковского счета и банковские реквизиты для внесения платы за содержание жилого помещения и коммунальных услуг</div>
                <div class="bill-font-2 cell-bottom-border">№ лицевого счета</div>
                <div class="bill-font-3 cell-right-border">${storedPref.recipient.name}</div>
                <div class="bill-font-3 cell-right-border">ИНН ${storedPref.recipient.inn} КПП ${storedPref.recipient.kpp} р/с ${storedPref.recipient.calc_acc} ${storedPref.recipient.bank}, к/с ${storedPref.recipient.corr_acc}, БИК ${storedPref.recipient.bik}</div>
                <div class="bill-font-3">${bill.AccountNumber}</div>
            </div>
            <p class="bill-font-1 bill-step-h1">Расчет размера платы за содержание и ремонт жилого помещения и коммунальные услуги</p>
            <div class="payment-header-table" style="border-bottom-style: none">
                <div class="cell-bottom-border cell-right-border">Виды услуг</div>
                <div class="cell-bottom-border cell-right-border">Объем</div>
                <div class="cell-bottom-border cell-right-border">Тариф</div>
                <div class="cell-bottom-border cell-right-border">Начислено</div>
                <div class="cell-bottom-border cell-right-border">Перерасчет</div>
                <div class="cell-bottom-border">Итого к оплате</div>
                <div class="cell-bottom-border cell-right-border">1</div>
                <div class="cell-bottom-border cell-right-border">2</div>
                <div class="cell-bottom-border cell-right-border">3</div>
                <div class="cell-bottom-border cell-right-border">4</div>
                <div class="cell-bottom-border cell-right-border">5</div>
                <div class="cell-bottom-border">6</div>
                ${payments[0]}
            </div>
            <div class="payment-footer-table">
                <div></div>
                <div>${payments[1].toFixed(2)}</div>
            </div>
            <p class="total-sum">Итого к оплате: ${payments[1].toFixed(2)} руб.</p>
        </div>`;
        let area = document.querySelector('.pages-area');
        area.innerHTML += html;

        bill.printed = true;
        return true;
    }

    function serviseRows(bill){
        try {
            let result = ['', 0.00];
            if (typeof bill === 'undefined')
                return ['Нет данных по задолженности', 0.00];
            for (const coll of Object.values(bill.SerivceCollections)){
                for (const serv of Object.values(coll.Services)){
                    let service = bills.preparedData.serviceDict[serv.ServiceId];
                    result[0] += `<div class="cell-bottom-border cell-right-border payment-table-name">${service.Name}</div>
                    <div class="cell-bottom-border cell-right-border payment-table-other">${serv.Consumption}</div>
                    <div class="cell-bottom-border cell-right-border payment-table-other">${serv.Price}</div>
                    <div class="cell-bottom-border cell-right-border payment-table-other">${serv.ChargeSum}</div>
                    <div class="cell-bottom-border cell-right-border payment-table-other">${serv.RecalculationSum??0.00}</div>
                    <div class="cell-bottom-border payment-table-other">${serv.ChargeSum + serv.RecalculationSum??0}</div>`;
                    result[1] += serv.ChargeSum + serv.RecalculationSum??0;
                }
            }
            return result;
        } catch (err){
            setError(err.message);
        }
    }

    function qrValue(bill){
        let data = serviseRows(bill);
        let pay = data[1].toFixed(2) *100;
        return `ST00012|
        Name=${storedPref.recipient.name}|
        PersonalAcc=${storedPref.recipient.calc_acc}|
        BankName=${storedPref.recipient.bank}|
        BIC=${storedPref.recipient.bik}|
        CorrespAcc=${storedPref.recipient.corr_acc}|
        PayeeINN=${storedPref.recipient.inn}|
        KPP=${storedPref.recipient.kpp}|
        Sum=${pay}|
        PersAcc=${bill.AccountNumber}|
        LastName=${bill.OwnerSurname}|
        FirstName=${bill.OwnerName}|
        MiddleName=${bill.OwnerMiddleName}|
        PaymPeriod=${preparedData.preferences.beginDate.month}.${preparedData.preferences.beginDate.year}|
        AddAmount=0`;
    }

    function period(){
        return `${months[preparedData.preferences.beginDate.month]} ${preparedData.preferences.beginDate.year} г.`
    }
    function checkHouseItem(){
        let grid = document.getElementById('houseGrid');
        let selHouses = grid.querySelectorAll('input.form-check-input:checked');
        let selCounts = 0;
        selHouses.forEach((item)=>{
           let cnt = item.getAttribute('data-count-length');
           selCounts += parseInt(cnt);
        });
        document.querySelector('.info-decimal[data-decimal-type="selected-houses"]').innerText = selHouses.length;
        document.querySelector('.info-decimal[data-decimal-type="selected-counts"]').innerText = selCounts;
    }
    function changeTab(elem){
        let tabs = document.querySelectorAll('.nav-link');
        tabs.forEach((tab)=>{
           if (tab !== elem){
               tab.setAttribute('aria-selected', 'false');
           }
        });
        elem.setAttribute('aria-selected', 'true');
    }

    function getPrefs(){
        return storedPref;
    }

    return Object.freeze({readBills, load, print, changeTab, preparedData, getPrefs, storedPref, png, setError} );
})();

document.addEventListener('DOMContentLoaded', () => {
    let btnMin = document.querySelector('.btn-min');
    let btnMax = document.querySelector('.btn-max');
    let btnClose = document.querySelector('.btn_close');
    let iconBtnMax = btnMax.children[0];

    let btnPrint = document.getElementById('btnPrint');

    let btnDownload = document.getElementById('btnDownload');
    let btnOutputPath = document.getElementById('btnSelectOutputPath');
    let btnSavePref = document.getElementById('btnSavePref');
    let btnSavePdf = document.getElementById('btnSavePdf');

    btnMin.addEventListener('click', ()=>{
       wnd.minimize();
    });

    btnMax.addEventListener('click', ()=>{
       if (!wnd.isMaximized()){
           wnd.maximize();
           iconBtnMax.classList.remove('fa-window-maximize');
           iconBtnMax.classList.add('fa-window-restore');
       } else {
           wnd.unmaximize();
           iconBtnMax.classList.add('fa-window-maximize');
           iconBtnMax.classList.remove('fa-window-restore');
       }
    });

    btnClose.addEventListener('click', ()=>{
       wnd.close();
    });

    btnDownload.addEventListener('click', () => {
        let options = {
            title : "Выбрать файл с платежами",
            buttonLabel : "Выбрать",
            filters :[
                {name: 'Выгрузка Новая Волна', extensions: ['json']}
            ],
            properties: ['openFile']
        }
        remote.dialog.showOpenDialog( options).then((data)=>{
            document.getElementById('jsonFile').value = data.filePaths[0];
            bills.readBills(data.filePaths[0]);
        });
    });

    btnOutputPath.addEventListener('click', () => {
        let options = {
            title : "Укажите путь для сохранения квитанций",
            buttonLabel : "Выбрать",
            properties: ['openDirectory']
        }
        remote.dialog.showOpenDialog(options).then((dir)=>{
            document.getElementById('outputPath').value = dir.filePaths[0];
        });
    });

    btnSavePref.addEventListener('click', () => {
        let inputs = document.querySelectorAll('.stored-pref');
        inputs.forEach((item)=>{
            let attr = item.getAttribute('data-field-name');
            let words = attr.split('.');
            if (words.length === 1){
                bills.storedPref[words[0]] = item.value;
            } else {
                bills.storedPref[words[0]][words[1]] = item.value;
            }
        });
        let json = JSON.stringify(bills.storedPref);
        if (!fs.existsSync('./pref')){
            fs.mkdirSync('./pref');
        }
        fs.writeFileSync(`./pref/pref.json`, json);
    });

    btnSavePdf.addEventListener('click', async () => {
        let pdfFile = await pdfCreator.create();
    });

    btnPrint.addEventListener('click', ()=>{
       if (bills.print()){
            let triggerEl = document.querySelector('#myTab button[data-bs-target="#printAreaTab"]');
            bootstrap.Tab.getInstance(triggerEl).show();
       }
    });

    let tab1 = document.getElementById('house-list-tab');
    tab1.addEventListener('click', () => bills.changeTab(tab1));

    let tab2 = document.getElementById('print-area-tab');
    tab2.addEventListener('click', () => bills.changeTab(tab2));

    const triggerTabList = document.querySelectorAll('#myTab button')
    triggerTabList.forEach(triggerEl => {
        const tabTrigger = new bootstrap.Tab(triggerEl)

        triggerEl.addEventListener('click', event => {
            event.preventDefault()
            tabTrigger.show()
        })
    })

    bills.load();
});

window.addEventListener('resize', () => {
    let btnMax = document.querySelector('.btn-max');
    let iconBtnMax = btnMax.children[0];

    if (wnd.isMaximized()){
        wnd.maximize();
        iconBtnMax.classList.remove('fa-window-maximize');
        iconBtnMax.classList.add('fa-window-restore');
    } else {
        wnd.unmaximize();
        iconBtnMax.classList.add('fa-window-maximize');
        iconBtnMax.classList.remove('fa-window-restore');
    }
});